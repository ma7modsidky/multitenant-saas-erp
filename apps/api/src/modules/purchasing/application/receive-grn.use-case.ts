import { INVENTORY_MOVEMENT_PORT, PURCHASING_EVENTS, type InventoryMovementPort } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import type { TxOrDb } from '../../../core/database/repository.base.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Grn, GRN_STATUS, PurchaseOrder, PO_STATUS, type GrnLineInput } from '../domain/index.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';
import { buildGrnReceivedEvent } from '../events/published/index.js';

export interface ReceiveGrnInput {
  poId: string;
  warehouseId?: string | null;
  lines: GrnLineInput[];
  /** PUR-13: client-generated key so a retried receipt is a no-op. */
  idempotencyKey?: string | null;
}

/**
 * ReceiveGrnUseCase — PUR-4/PUR-5: creates the GRN and RECEIVES it in one
 * transaction. Each goods line calls INVENTORY_MOVEMENT_PORT.receive INSIDE the
 * same transaction (at the PO's snapshot cost — INV-12 moving average
 * recalculates), the PO line's received_quantity advances, and the GRN flips
 * to `received`. If any stock operation fails, the whole GRN fails (atomicity).
 * A received GRN is immutable (PUR-5); the DB trigger
 * `pur_enforce_grn_quantity` backstops overshoot under concurrency (PUR-4).
 */
@Injectable()
export class ReceiveGrnUseCase {
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

  async execute(input: ReceiveGrnInput): Promise<{ grnId: string; number: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? 'system';
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      const poRow = await this.repo.findPurchaseOrderById(input.poId, tx);
      if (!poRow) throw new NotFoundError('PURCHASING_PO_NOT_FOUND', { poId: input.poId });
      if (poRow.status === PO_STATUS.CANCELLED || poRow.status === PO_STATUS.DRAFT) {
        throw new NotFoundError('PURCHASING_PO_NOT_APPROVED', { poId: input.poId, status: poRow.status });
      }

      const poLines = await this.repo.listPoLines(input.poId, tx);
      const poLineById = new Map(poLines.map((line) => [line.id, line]));

      const grn = Grn.create({
        id: crypto.randomUUID(),
        organizationId,
        number: await this.allocateGrnNumber(tx),
        poId: input.poId,
        supplierId: poRow.supplierId,
        warehouseId: input.warehouseId ?? null,
        lines: input.lines,
        now,
      });

      // PUR-4: validate each GRN line against the PO line's remaining quantity
      // BEFORE touching stock (the DB trigger is the concurrency backstop).
      const po = PurchaseOrder.fromJSON({ ...poRow, lines: poRow.lines });
      for (const line of grn.lines) {
        const poLine = poLineById.get(line.poLineId);
        if (!poLine) {
          throw new NotFoundError('PURCHASING_PO_LINE_NOT_FOUND', { poLineId: line.poLineId });
        }
        po.applyReceived(line.poLineId, line.quantity);
      }

      // PUR-4: stock increase atomically with the GRN, at the PO snapshot cost.
      await this.getMovementPort().receive(
        {
          lines: grn.lines
            .filter((line) => line.variantId !== null)
            .map((line) => ({
              variantId: line.variantId!,
              quantity: line.quantity,
              unitCostAmountMinor: line.unitCostMinor,
              unitCostCurrency: line.unitCostCurrency,
            })),
          ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
          referenceType: 'purchase_receipt',
          referenceId: grn.id,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        },
        this.txManager.ref(tx),
        this.unitOfWork,
      );

      // PUR-5: flip the GRN to received (immutable from here on).
      grn.receive(userId, now);
      // IMPORTANT ORDER: the GRN lines must be INSERTED before the PO lines'
      // received_quantity projection advances — the pur_enforce_grn_quantity
      // trigger validates `received + new <= ordered` at insert time, so
      // advancing the projection first would make a VALID full receipt look
      // like an overshoot (3 received + 3 new > 3 ordered).
      await this.repo.insertGrn(grn.toJSON(), tx);
      await this.repo.updateGrnStatus(grn.id, GRN_STATUS.RECEIVED, now, userId, tx);

      // PUR-4: advance the PO lines' received_quantity projections (after the
      // GRN insert, so the trigger sees the pre-receipt quantities).
      for (const line of grn.lines) {
        const poLine = poLineById.get(line.poLineId)!;
        const newReceived = addQuantity(poLine.receivedQuantity, line.quantity);
        await this.repo.updatePoLineReceived(line.poLineId, newReceived, tx);
      }

      // PUR-3: advance the PO — partially_received → received when every line
      // is fully received.
      const allReceived = grn.lines.every(
        (line) =>
          compareQuantity(
            addQuantity(poLineById.get(line.poLineId)!.receivedQuantity, line.quantity),
            poLineById.get(line.poLineId)!.quantity,
          ) >= 0,
      );
      try {
        po.transitionTo(allReceived ? PO_STATUS.RECEIVED : PO_STATUS.PARTIALLY_RECEIVED, now);
        await this.repo.updatePurchaseOrderStatus(input.poId, po.status, tx);
      } catch {
        // PO already in a further state (received/closed) — nothing to do.
      }

      const event = buildGrnReceivedEvent(
        organizationId,
        grn.id,
        grn.toJSON().number,
        input.poId,
        poRow.supplierId,
        input.warehouseId ?? null,
        grn.lines.length,
        now,
      );
      return { grnId: grn.id, number: grn.toJSON().number, event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return { grnId: committed.grnId, number: committed.number };
  }

  /** PUR-3/PUR-6: sequential, gap-free GRN numbers per org (GRN-xxxxx). */
  private async allocateGrnNumber(tx: TxOrDb): Promise<string> {
    await this.repo.ensureOrgSettings(tx);
    return this.repo.allocateGrnNumber(tx);
  }
}

// ─── decimal quantity helpers (numeric(18,4) strings) ───────────────────────

/** Parse a decimal string into ×10⁴ integer units. */
function parseQuantity(value: string): bigint {
  const [whole = '0', frac = '0'] = value.split('.');
  const fracPadded = frac.padEnd(4, '0').slice(0, 4);
  return BigInt(whole) * 10000n + BigInt(fracPadded);
}

/** Format ×10⁴ integer units back to a decimal string. */
function formatQuantity(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 10000n;
  const frac = (abs % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Exact sum of two decimal quantities. */
function addQuantity(a: string, b: string): string {
  return formatQuantity(parseQuantity(a) + parseQuantity(b));
}

function compareQuantity(a: string, b: string): number {
  const diff = parseQuantity(a) - parseQuantity(b);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}
