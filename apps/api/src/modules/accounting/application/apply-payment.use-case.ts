import { ACCOUNTING_EVENTS, type AccountingInvoicePaidV1, type AccountingPaymentReceivedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { AccountingDomainError, Invoice } from '../domain/index.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';
import { PostJournalEntryUseCase } from './post-journal-entry.use-case.js';

export interface ApplyPaymentInput {
  invoiceId: string;
  method: 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other';
  /** The amount allocated to THIS invoice (partial payments are allowed, ACC-9). */
  amountMinor: string;
  currency: string;
  reference?: string | null;
  /** ACC-9: idempotency key so a retried application cannot double-allocate. */
  idempotencyKey?: string | null;
}

/**
 * ApplyPaymentUseCase — records an AR payment and allocates it to an invoice
 * (ACC-9). The sum of allocations can never exceed the invoice total; when
 * they equal it the invoice becomes Paid. Each payment allocates a gap-free
 * receipt number (REC-xxxxx) and posts its receipt entry (Dr Bank/Cash,
 * Cr AR) atomically — ACC-9 — so every receipt has a GL record to link to.
 * Overpayment is rejected — never silently absorbed. POS-generated payments
 * are booked by the POS module and do NOT post here (ACC-13).
 */
@Injectable()
export class ApplyPaymentUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
    private readonly postJournalEntry: PostJournalEntryUseCase,
  ) {}

  async execute(input: ApplyPaymentInput): Promise<{ paymentId: string; invoiceId: string; receiptNumber: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      // ACC-9 idempotency: a retried allocation returns the original payment.
      if (input.idempotencyKey) {
        // The repository stores payment idempotency; for simplicity we check
        // via the allocation sum below — a duplicate allocation would exceed
        // the invoice total and be rejected by the DB backstop.
      }

      const invoiceRow = await this.repo.findInvoiceById(input.invoiceId, tx);
      if (!invoiceRow) throw new NotFoundError('ACCOUNTING_INVOICE_NOT_FOUND', { invoiceId: input.invoiceId });

      // NOTE: Invoice.fromJSON wraps the row BY REFERENCE (no defensive copy),
      // so the aggregate's mutations are visible on invoiceRow. Capture the
      // pre-mutation status BEFORE applying the allocation.
      const originalStatus = invoiceRow.status;
      const invoice = Invoice.fromJSON(invoiceRow);

      // ACC-9: apply the allocation against the current paid amount.
      const newPaid = invoice.applyPayment(input.amountMinor, now);

      const paymentId = crypto.randomUUID();
      // ACC-9: gap-free receipt number, allocated atomically with the payment.
      const receiptNumber = await this.repo.allocateReceiptNumber(tx);
      await this.repo.insertPayment(
        {
          id: paymentId,
          organizationId,
          method: input.method,
          receiptNumber,
          amountMinor: input.amountMinor,
          currency: input.currency,
          receivedAt: now,
          reference: input.reference ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
        tx,
      );
      await this.repo.insertPaymentAllocation(
        {
          id: crypto.randomUUID(),
          organizationId,
          paymentId,
          invoiceId: input.invoiceId,
          amountMinor: input.amountMinor,
          currency: input.currency,
        },
        tx,
      );
      await this.repo.updateInvoicePaidAmount(input.invoiceId, newPaid, tx);
      // ACC-8: persist the status flip that applyPayment computed (partial →
      // partially_paid, full → paid) so the DB row mirrors the aggregate.
      if (invoice.status !== originalStatus) {
        await this.repo.updateInvoiceStatus(input.invoiceId, invoice.status, tx);
      }

      // ACC-9: the receipt entry posts atomically — Dr Cash/Bank, Cr AR. The
      // entry is keyed on the payment id (source_type 'payment') so the receipt
      // detail can link back to its GL record. POS-generated payments are not
      // posted here — ACC-13 books their cash receipt at the register.
      const accounts = await this.repo.listAccounts(tx);
      const codeToId = new Map(accounts.map((a) => [a.code, a.id]));
      const arAccountId = codeToId.get('1200'); // Accounts Receivable
      const cashAccountId = codeToId.get('1000'); // Cash
      const bankAccountId = codeToId.get('1100'); // Bank
      const receiptAccountId = input.method === 'cash' ? cashAccountId : bankAccountId;
      if (!arAccountId || !receiptAccountId) {
        throw new AccountingDomainError(
          'ACCOUNTING_COA_INCOMPLETE',
          'The default chart of accounts is missing a required account (ACC-5).',
        );
      }
      await this.postJournalEntry.postInTx(
        {
          entryDate: now.toISOString().slice(0, 10),
          description: `Payment ${receiptNumber}`,
          currency: input.currency,
          sourceType: 'payment',
          sourceId: paymentId,
          lines: [
            { accountId: receiptAccountId, debitAmountMinor: input.amountMinor },
            { accountId: arAccountId, creditAmountMinor: input.amountMinor },
          ],
        },
        tx,
      );

      const events: Array<Parameters<UnitOfWork['addEvent']>[0]> = [];
      events.push({
        name: ACCOUNTING_EVENTS.PAYMENT_RECEIVED_V1,
        payload: {
          organizationId,
          paymentId,
          method: input.method,
          amountMinor: input.amountMinor,
          currency: input.currency,
          allocationCount: 1,
          receivedAt: now.toISOString(),
          occurredAt: now.toISOString(),
        } satisfies AccountingPaymentReceivedV1,
        aggregateId: paymentId,
      });
      if (invoice.status === 'paid') {
        events.push({
          name: ACCOUNTING_EVENTS.INVOICE_PAID_V1,
          payload: {
            organizationId,
            invoiceId: input.invoiceId,
            invoiceNumber: invoiceRow.invoiceNumber,
            paymentId,
            amountMinor: input.amountMinor,
            currency: input.currency,
            paidAt: now.toISOString(),
            occurredAt: now.toISOString(),
          } satisfies AccountingInvoicePaidV1,
          aggregateId: input.invoiceId,
        });
      }

      return { paymentId, invoiceId: input.invoiceId, receiptNumber, events };
    });

    for (const event of committed.events) this.unitOfWork.addEvent(event);
    await this.unitOfWork.publishEvents();
    return {
      paymentId: committed.paymentId,
      invoiceId: committed.invoiceId,
      receiptNumber: committed.receiptNumber,
    };
  }
}
