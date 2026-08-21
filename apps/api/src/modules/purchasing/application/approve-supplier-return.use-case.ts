import { INVENTORY_MOVEMENT_PORT, PURCHASING_EVENTS, type InventoryMovementPort } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import type { TxOrDb } from '../../../core/database/repository.base.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  LEDGER_ENTRY_TYPE,
  PURCHASING_ERROR_CODE,
  PurchasingDomainError,
  SupplierReturn,
  VendorLedgerEntry,
} from '../domain/index.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';
import { buildSupplierReturnApprovedEvent } from '../events/published/index.js';

export interface ApproveSupplierReturnInput {
  supplierReturnId: string;
  /** PUR-13: client-generated key so a retried approval is a no-op. */
  idempotencyKey?: string | null;
}

/**
 * ApproveSupplierReturnUseCase — PUR-11: approves a draft supplier return /
 * debit note. Approval reduces AP (negative vendor-ledger entry) AND removes
 * stock through INVENTORY_MOVEMENT_PORT.returnToSupplier, in ONE transaction —
 * if the stock operation fails, the return is never approved. Publishes
 * `purchasing.supplier_return.approved.v1` after commit so accounting can post
 * the debit-note reversal (Cr Inventory, Dr AP).
 */
@Injectable()
export class ApproveSupplierReturnUseCase {
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

  async execute(input: ApproveSupplierReturnInput): Promise<{ returnId: string; number: string; status: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? 'system';
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      const row = await this.repo.findSupplierReturnById(input.supplierReturnId, tx);
      if (!row) {
        throw new NotFoundError('PURCHASING_RETURN_NOT_FOUND', { supplierReturnId: input.supplierReturnId });
      }
      if (row.status !== 'draft') {
        return { returnId: row.id, number: row.number, status: row.status, event: null as never, replay: true };
      }
      if (input.idempotencyKey) {
        const replayed = await this.repo.findLedgerEntryByIdempotencyKey(input.idempotencyKey, tx);
        if (replayed) {
          return { returnId: row.id, number: row.number, status: row.status, event: null as never, replay: true };
        }
      }

      const supplierReturn = SupplierReturn.fromJSON(row);

      // PUR-11: remove stock through the movement port — atomically with the
      // AP reduction below.
      const goodsLines = supplierReturn.lines.filter((line) => line.variantId !== null);
      if (goodsLines.length > 0) {
        await this.getMovementPort().returnToSupplier(
          {
            lines: goodsLines.map((line) => ({
              variantId: line.variantId!,
              quantity: line.quantity,
              unitCostAmountMinor: line.unitCostMinor,
              unitCostCurrency: line.unitCostCurrency,
            })),
            reasonCode: supplierReturn.reasonCode,
            referenceType: 'supplier_return',
            referenceId: supplierReturn.id,
            ...(input.idempotencyKey ? { idempotencyKey: `${input.idempotencyKey}-return` } : {}),
          },
          this.txManager.ref(tx),
          this.unitOfWork,
        );
      }

      // PUR-11: approve the return + write the negative AP ledger entry. The
      // ledger entry is the GROSS reduction (net + tax, ACC-11) so the vendor
      // balance matches the accounting AP debit.
      supplierReturn.approve(userId, now);
      const entry = VendorLedgerEntry.create({
        id: crypto.randomUUID(),
        organizationId,
        supplierId: supplierReturn.supplierId,
        type: LEDGER_ENTRY_TYPE.DEBIT_NOTE,
        amountMinor: supplierReturn.totalMinor,
        currency: supplierReturn.currency,
        referenceType: 'supplier_return',
        referenceId: supplierReturn.id,
        idempotencyKey: input.idempotencyKey ?? null,
        now,
      });
      await this.repo.insertLedgerEntry(entry.toJSON(), tx);
      await this.repo.updateSupplierReturnStatus(supplierReturn.id, supplierReturn.status, now, tx);

      const event = buildSupplierReturnApprovedEvent(
        organizationId,
        supplierReturn.id,
        supplierReturn.number,
        supplierReturn.supplierId,
        supplierReturn.billId,
        supplierReturn.reasonCode,
        supplierReturn.amountMinor,
        supplierReturn.currency,
        supplierReturn.taxMinor,
        supplierReturn.supplierTaxIdSnapshot,
        // ACC-15 + ACC-11: per-line detail so accounting credits Inventory
        // (goods) vs Expense (service) and reverses the input-VAT leg.
        supplierReturn.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          unitCostAmountMinor: l.unitCostMinor,
          taxRateBpSnapshot: l.taxRateBpSnapshot,
          taxAmountMinor: l.taxAmountMinor,
        })),
        now,
      );
      return {
        returnId: supplierReturn.id,
        number: supplierReturn.number,
        status: supplierReturn.status,
        event,
        replay: false,
      };
    });

    if (!committed.replay && committed.event) {
      this.unitOfWork.addEvent(committed.event);
      await this.unitOfWork.publishEvents();
    }
    return { returnId: committed.returnId, number: committed.number, status: committed.status };
  }
}
