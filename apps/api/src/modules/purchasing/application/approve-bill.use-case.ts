import { INVENTORY_MOVEMENT_PORT, PURCHASING_EVENTS, type InventoryMovementPort } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import type { TxOrDb } from '../../../core/database/repository.base.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
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
import { buildBillApprovedEvent } from '../events/published/index.js';

export interface ApproveBillInput {
  billId: string;
  /** PUR-13: client-generated key so a retried approval is a no-op. */
  idempotencyKey?: string | null;
}

/**
 * ApproveBillUseCase — PUR-6/7/9: approves a draft bill.
 *
 * PUR-6 (three-way match): every GOODS line must reference a line on a
 * RECEIVED GRN (service bills are exempt). On approval the AP vendor-ledger
 * entry is recorded (bill +) and `purchasing.bill.approved.v1` is published
 * after commit so accounting posts Dr Inventory/Expense, Cr AP, Cr VAT.
 *
 * PUR-9 (cost variance): when the bill's unit cost differs from the GRN/PO
 * snapshot cost, a `cost_adjustment` movement posts the variance through
 * INVENTORY_MOVEMENT_PORT.adjustCost INSIDE the same transaction — historical
 * cost is never rewritten (INV-12).
 *
 * PUR-13: a retried approval with the same idempotency key is a no-op
 * (at-most-once effect; replays return the original result).
 */
@Injectable()
export class ApproveBillUseCase {
  private movementPort: InventoryMovementPort | null = null;

  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
    private readonly portRegistry: PortRegistry,
  ) {}

  private getMovementPort(): InventoryMovementPort {
    this.movementPort ??= this.portRegistry.resolve<InventoryMovementPort>(INVENTORY_MOVEMENT_PORT);
    return this.movementPort;
  }

  async execute(input: ApproveBillInput): Promise<{ billId: string; number: string; status: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      const row = await this.repo.findBillById(input.billId, tx);
      if (!row) throw new NotFoundError('PURCHASING_BILL_NOT_FOUND', { billId: input.billId });

      // PUR-13: a replayed approval is a no-op — return the original result.
      if (row.status !== BILL_STATUS.DRAFT) {
        return { billId: row.id, number: row.number, status: row.status, event: null as never, ledger: false };
      }
      if (input.idempotencyKey) {
        const replayed = await this.repo.findLedgerEntryByIdempotencyKey(input.idempotencyKey, tx);
        if (replayed) {
          return { billId: row.id, number: row.number, status: row.status, event: null as never, ledger: false };
        }
      }

      const bill = Bill.fromJSON(row);

      // PUR-6: three-way match — every goods line needs a received GRN. The
      // bill rows carry grnLineId/variantId; goods lines are those with a
      // variant AND no grn reference are rejected.
      for (const line of bill.lines) {
        if (line.variantId !== null && !line.grnLineId) {
          throw new PurchasingDomainError(
            PURCHASING_ERROR_CODE.BILL_MISSING_GRN,
            `Bill ${bill.number} line for variant ${line.variantId} has no received GRN (PUR-6).`,
            { billNumber: bill.number, variantId: line.variantId },
          );
        }
      }

      // PUR-9: cost variance — compare the bill's unit cost to the GRN/PO
      // snapshot and post a cost_adjustment movement for the delta.
      for (const line of bill.lines) {
        if (!line.variantId || !line.grnLineId) continue;
        // Resolve the GRN line's snapshot cost (the received cost).
        const grnLine = await this.repo.findGrnLineById(line.grnLineId, tx);
        if (!grnLine) continue;
        const variancePerUnit = BigInt(line.unitCostMinor) - BigInt(grnLine.unitCostMinor);
        if (variancePerUnit === 0n) continue;
        const qty = parseQuantityScaled(line.quantity);
        const delta = (variancePerUnit * qty) / 10000n;
        if (delta === 0n) continue;
        await this.getMovementPort().adjustCost(
          {
            variantId: line.variantId,
            costDeltaAmountMinor: delta.toString(),
            currency: line.unitCostCurrency,
            referenceType: 'bill_cost_variance',
            referenceId: bill.id,
            ...(input.idempotencyKey ? { idempotencyKey: `${input.idempotencyKey}-cost-${line.id}` } : {}),
          },
          this.txManager.ref(tx),
          this.unitOfWork,
        );
      }

      // PUR-6: the approval flip + the AP ledger entry (bill +).
      bill.approve(now);
      const entry = VendorLedgerEntry.create({
        id: crypto.randomUUID(),
        organizationId,
        supplierId: row.supplierId,
        type: LEDGER_ENTRY_TYPE.BILL,
        amountMinor: bill.totalMinor,
        currency: bill.currency,
        referenceType: 'bill',
        referenceId: bill.id,
        idempotencyKey: input.idempotencyKey ?? null,
        now,
      });
      await this.repo.insertLedgerEntry(entry.toJSON(), tx);
      await this.repo.updateBillStatus(bill.id, BILL_STATUS.APPROVED, tx);

      const event = buildBillApprovedEvent(
        organizationId,
        bill.id,
        bill.number,
        row.supplierId,
        {
          subtotalAmountMinor: bill.toJSON().subtotalMinor,
          discountAmountMinor: bill.toJSON().discountMinor,
          taxAmountMinor: bill.toJSON().taxMinor,
          totalAmountMinor: bill.totalMinor,
          currency: bill.currency,
        },
        // ACC-15: per-line detail so accounting splits Dr Inventory (goods)
        // vs Dr Expense (service lines).
        bill.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          unitCostAmountMinor: l.unitCostMinor,
          taxRateBpSnapshot: l.taxRateBpSnapshot,
        })),
        bill.toJSON().billDate,
        bill.toJSON().dueDate,
        now,
      );

      return { billId: bill.id, number: bill.number, status: bill.status, event, ledger: true };
    });

    if (committed.event) {
      this.unitOfWork.addEvent(committed.event);
      await this.unitOfWork.publishEvents();
    }
    return { billId: committed.billId, number: committed.number, status: committed.status };
  }
}

/** Parse a decimal quantity into ×10⁴ integer units. */
function parseQuantityScaled(value: string): bigint {
  const [whole = '0', frac = '0'] = value.split('.');
  const fracPadded = frac.padEnd(4, '0').slice(0, 4);
  return BigInt(whole) * 10000n + BigInt(fracPadded);
}
