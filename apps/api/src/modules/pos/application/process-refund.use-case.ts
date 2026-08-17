import { INVENTORY_STOCK_PORT, POS_EVENTS, type InventoryStockPort, type PosSaleRefundedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  PosError,
  POS_ERROR_CODE,
  Refund,
  SALE_STATUS,
  Sale,
  decimalQuantityExceeds,
  parseMinor,
  sumDecimalQuantities,
} from '../domain/index.js';
import { type RefundLineInput } from '../domain/index.js';

import { POS_REPOSITORY, type PosRepository } from './ports/index.js';

export interface ProcessRefundInput {
  originalSaleId: string;
  registerId: string;
  /** POS-23: a refund requires a reason code. */
  reasonCode: string;
  /** The register currency = the org base currency (POS-11). */
  currency: string;
  lines: RefundLineInput[];
}

/**
 * ProcessRefundUseCase — refunds part or all of a completed sale.
 *
 * Business rules:
 * - POS-20: the refund references an existing completed sale in the same org.
 * - POS-21: cumulative refunded quantity per line ≤ sold quantity and
 *   cumulative refunded amount ≤ the sale total.
 * - POS-22: restock is per line; restocked lines create a `return` movement,
 *   non-restocked (damaged) lines a `write_off` — via INVENTORY_STOCK_PORT
 *   inside the SAME transaction as the refund.
 * - POS-23: a refund requires an open shift and a reason code.
 * - POS-24: refunding more than the drawer's cash is permitted; the shift
 *   variance report flags it.
 */
@Injectable()
export class ProcessRefundUseCase {
  private stockPort: InventoryStockPort | null = null;

  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
    private readonly portRegistry: PortRegistry,
  ) {}

  /**
   * Level 3 port — resolved LAZILY on first use (POS-22). The inventory
   * module registers the implementation during its `onModuleInit`, which Nest
   * runs AFTER every provider has been constructed; resolving in the
   * constructor would throw `INVENTORY_STOCK_PORT is not registered` at boot.
   */
  private getStockPort(): InventoryStockPort {
    this.stockPort ??= this.portRegistry.resolve<InventoryStockPort>(INVENTORY_STOCK_PORT);
    return this.stockPort;
  }

  async execute(input: ProcessRefundInput): Promise<{ refundId: string; amountMinor: string; refundedAt: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      // POS-20: the original sale must exist in this org and still be
      // refundable. POS-21 allows SUCCESSIVE partial refunds (cumulative caps
      // are checked below), so a partially-refunded sale remains refundable;
      // only a fully refunded or voided sale is closed to refunds.
      const saleRow = await this.repo.findSaleById(input.originalSaleId, tx);
      if (!saleRow) throw new NotFoundError('POS_SALE_NOT_FOUND', { saleId: input.originalSaleId });
      const sale = Sale.fromPersistence(saleRow);
      if (sale.status === SALE_STATUS.REFUNDED || sale.status === SALE_STATUS.VOIDED) {
        throw new PosError(
          POS_ERROR_CODE.REFUND_SALE_NOT_REFUNDABLE,
          'A fully refunded or voided sale cannot be refunded again (POS-20).',
          { saleId: sale.id, status: sale.status },
        );
      }

      // POS-23: a refund requires an open shift on the register.
      const register = await this.repo.findRegisterById(input.registerId, tx);
      if (!register) throw new NotFoundError('POS_REGISTER_NOT_FOUND', { registerId: input.registerId });
      const shift = await this.repo.findOpenShiftByRegister(input.registerId, tx);
      if (!shift) {
        throw new PosError(
          POS_ERROR_CODE.REFUND_REQUIRES_OPEN_SHIFT,
          'A refund requires an open shift on the register (POS-23).',
          { registerId: input.registerId },
        );
      }

      // POS-21: every refund line must reference a line of the original sale,
      // and the cumulative refunded quantity per line cannot exceed what was
      // sold. The amount cap is checked against the whole sale below.
      const saleLinesById = new Map(sale.lines.map((line) => [line.id, line]));
      let newRefundTotal = 0n;
      for (const line of input.lines) {
        const original = saleLinesById.get(line.saleLineId);
        if (!original || original.variantId !== line.variantId) {
          throw new PosError(
            POS_ERROR_CODE.REFUND_LINE_INVALID,
            'A refund line must reference a line of the original sale (POS-21).',
            { saleLineId: line.saleLineId },
          );
        }
        const refundedQty = await this.repo.cumulativeRefundedQuantityByLine(line.saleLineId, tx);
        // POS-21: quantities are decimal strings with variable scale, so the
        // sum must be normalized before comparison ('0.5' + '0.25' = 0.75).
        if (decimalQuantityExceeds(sumDecimalQuantities(refundedQty, line.quantity), original.quantity)) {
          throw new PosError(
            POS_ERROR_CODE.REFUND_EXCEEDS_SALE,
            'Cumulative refunded quantity cannot exceed the originally sold quantity (POS-21).',
            { saleLineId: line.saleLineId },
          );
        }
        newRefundTotal += parseMinor(line.amountMinor);
      }

      // POS-21: cumulative refunded amount can never exceed the sale total.
      const alreadyRefunded = await this.repo.cumulativeRefundedAmountBySale(sale.id, tx);
      if (parseMinor(alreadyRefunded) + newRefundTotal > parseMinor(sale.totalAmountMinor)) {
        throw new PosError(
          POS_ERROR_CODE.REFUND_EXCEEDS_SALE,
          'Cumulative refunds cannot exceed the sale total (POS-21).',
          { saleId: sale.id },
        );
      }

      const refund = Refund.create({
        id: crypto.randomUUID(),
        organizationId,
        originalSaleId: sale.id,
        shiftId: shift.id,
        registerId: input.registerId,
        reasonCode: input.reasonCode,
        currency: input.currency,
        lines: input.lines,
        refundedAt: now,
        createdBy: userId,
      });

      // POS-22: stock movements via the port, in this transaction — return for
      // restocked lines, write_off for damaged ones. Stock is never silently
      // unchanged.
      const txRef = this.txManager.ref(tx);
      for (const line of refund.lines) {
        await this.getStockPort().restock(
          {
            variantId: line.variantId,
            warehouseId: register.warehouseId,
            quantity: line.quantity,
            restock: line.restock,
            referenceType: 'pos_refund',
            referenceId: refund.id,
          },
          txRef,
          // Same collector contract as checkout (ACC-15): inventory registers
          // movement_recorded on our unit of work, published after commit.
          this.unitOfWork,
        );
      }

      await this.repo.insertRefund(refund.toJSON(), tx);

      // POS-21 bookkeeping: flip the sale to refunded / partially_refunded.
      const cumulativeAfter = parseMinor(alreadyRefunded) + newRefundTotal;
      sale.markRefunded({ fully: cumulativeAfter >= parseMinor(sale.totalAmountMinor), now });
      await this.repo.updateSaleStatus(sale.id, sale.status, tx);

      const payload: PosSaleRefundedV1 = {
        organizationId,
        refundId: refund.id,
        originalSaleId: sale.id,
        shiftId: shift.id,
        registerId: input.registerId,
        refundedAmountMinor: refund.amountMinor,
        currency: refund.currency,
        refundedAt: now.toISOString(),
        occurredAt: now.toISOString(),
      };
      const event = {
        name: POS_EVENTS.SALE_REFUNDED_V1,
        payload,
        aggregateId: sale.id,
      } satisfies Parameters<UnitOfWork['addEvent']>[0];

      return { refundId: refund.id, amountMinor: refund.amountMinor, refundedAt: now.toISOString(), event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return { refundId: committed.refundId, amountMinor: committed.amountMinor, refundedAt: committed.refundedAt };
  }
}
