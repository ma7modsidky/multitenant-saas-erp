import { PURCHASING_EVENTS } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import type { TxOrDb } from '../../../core/database/repository.base.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  Bill,
  BILL_STATUS,
  LEDGER_ENTRY_TYPE,
  PURCHASING_ERROR_CODE,
  PurchasingDomainError,
  VendorLedgerEntry,
} from '../domain/index.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';
import { buildPaymentRecordedEvent } from '../events/published/index.js';

export interface RecordSupplierPaymentInput {
  supplierId: string;
  method: 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other';
  amountMinor: string;
  currency: string;
  paidAt?: string;
  reference?: string | null;
  /** Allocations across bills (PUR-7): billId → amount. */
  allocations: Array<{ billId: string; amountMinor: string }>;
  /** PUR-13: client-generated key so a retried payment is a no-op. */
  idempotencyKey?: string | null;
}

/**
 * RecordSupplierPaymentUseCase — PUR-7: records a cash disbursement and
 * allocates it across bills. Cumulative allocations per bill never exceed the
 * bill total; the vendor-ledger entry (payment −) is recorded and
 * `purchasing.payment.recorded.v1` is published after commit so accounting can
 * post Dr AP / Cr Bank.
 */
@Injectable()
export class RecordSupplierPaymentUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: RecordSupplierPaymentInput): Promise<{ paymentId: string; number: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      const supplier = await this.repo.findSupplierById(input.supplierId, tx);
      if (!supplier) throw new NotFoundError('PURCHASING_SUPPLIER_NOT_FOUND', { supplierId: input.supplierId });

      if (input.allocations.length === 0) {
        throw new PurchasingDomainError(
          PURCHASING_ERROR_CODE.PAYMENT_OVER_ALLOCATED,
          'A supplier payment must allocate across at least one bill (PUR-7).',
        );
      }

      // PUR-13: a replayed payment with the same key is a no-op.
      if (input.idempotencyKey) {
        const existing = await this.repo.findLedgerEntryByIdempotencyKey(input.idempotencyKey, tx);
        if (existing) {
          return { paymentId: existing.referenceId ?? crypto.randomUUID(), number: 'REPLAYED', replay: true };
        }
      }

      const paymentId = crypto.randomUUID();
      const number = await this.allocatePaymentNumber(tx);

      // PUR-7: apply allocations against each bill (rejects over-allocation).
      const allocatedTotal = input.allocations.reduce((sum, a) => sum + BigInt(a.amountMinor), 0n);
      if (allocatedTotal !== BigInt(input.amountMinor)) {
        throw new PurchasingDomainError(
          PURCHASING_ERROR_CODE.PAYMENT_OVER_ALLOCATED,
          `Allocation total (${allocatedTotal}) must equal the payment amount (${input.amountMinor}) (PUR-7).`,
        );
      }

      // IMPORTANT ORDER: the payment row must be INSERTED before its
      // allocations — pur_payment_allocations.payment_id has an FK to
      // pur_supplier_payments, so inserting the allocations first fails the
      // constraint.
      await this.repo.insertPayment(
        {
          id: paymentId,
          organizationId,
          number,
          supplierId: input.supplierId,
          method: input.method,
          amountMinor: input.amountMinor,
          currency: input.currency,
          paidAt: input.paidAt ? new Date(input.paidAt) : now,
          reference: input.reference ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
        tx,
      );

      // PUR-7: apply each allocation against its bill (rejects over-
      // allocation) and record the allocation row against the payment.
      for (const allocation of input.allocations) {
        const billRow = await this.repo.findBillById(allocation.billId, tx);
        if (!billRow) throw new NotFoundError('PURCHASING_BILL_NOT_FOUND', { billId: allocation.billId });
        if (billRow.status === BILL_STATUS.VOID || billRow.status === BILL_STATUS.DRAFT) {
          throw new PurchasingDomainError(
            PURCHASING_ERROR_CODE.PAYMENT_OVER_ALLOCATED,
            `Cannot allocate a payment to a ${billRow.status} bill (PUR-7).`,
            { billNumber: billRow.number },
          );
        }
        // Capture the PRE-payment status BEFORE applying: Bill.fromJSON keeps
        // a reference to billRow, so applyPayment's status flip would mutate
        // the same object and make the transition comparison below a no-op
        // (the DB status update would silently be skipped).
        const previousStatus = billRow.status;
        const bill = Bill.fromJSON(billRow);
        const newPaid = bill.applyPayment(allocation.amountMinor, now);
        await this.repo.updateBillPaidAmount(bill.id, newPaid, tx);
        if (bill.status !== previousStatus) {
          await this.repo.updateBillStatus(bill.id, bill.status, tx);
        }
        await this.repo.insertPaymentAllocation(
          {
            id: crypto.randomUUID(),
            organizationId,
            paymentId,
            billId: bill.id,
            amountMinor: allocation.amountMinor,
            currency: input.currency,
          },
          tx,
        );
      }

      // PUR-7/PUR-2: the AP ledger debit (payment −).
      const entry = VendorLedgerEntry.create({
        id: crypto.randomUUID(),
        organizationId,
        supplierId: input.supplierId,
        type: LEDGER_ENTRY_TYPE.PAYMENT,
        amountMinor: input.amountMinor,
        currency: input.currency,
        referenceType: 'payment',
        referenceId: paymentId,
        idempotencyKey: input.idempotencyKey ?? null,
        now,
      });
      await this.repo.insertLedgerEntry(entry.toJSON(), tx);

      const event = buildPaymentRecordedEvent(
        organizationId,
        paymentId,
        number,
        input.supplierId,
        input.method,
        input.amountMinor,
        input.currency,
        input.allocations.length,
        input.paidAt ? new Date(input.paidAt) : now,
      );
      return { paymentId, number, replay: false, event };
    });

    if (!committed.replay && committed.event) {
      this.unitOfWork.addEvent(committed.event);
      await this.unitOfWork.publishEvents();
    }
    return { paymentId: committed.paymentId, number: committed.number };
  }

  /** PUR-7: sequential, gap-free payment numbers per org (PAY-xxxxx). */
  private async allocatePaymentNumber(tx: TxOrDb): Promise<string> {
    await this.repo.ensureOrgSettings(tx);
    return this.repo.allocatePaymentNumber(tx);
  }
}
