import { INVENTORY_STOCK_PORT, POS_EVENTS, type InventoryStockPort, type PosSaleCompletedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { PosError, POS_ERROR_CODE, Register, Sale, type PaymentInput, type SaleLineInput } from '../domain/index.js';

import { POS_REPOSITORY, type PosRepository } from './ports/index.js';

export interface CheckoutInput {
  registerId: string;
  /**
   * The register's currency = the org base currency, resolved by the API layer
   * (POS-11: all lines and payments share it).
   */
  currency: string;
  /** POS-19: locale the sale was completed in. */
  locale: string;
  lines: SaleLineInput[];
  payments: PaymentInput[];
  /** POS-18: optional CRM contact link (no FK). */
  customerContactId?: string | null;
  /** POS-26: client-generated key; a retry returns the original sale. */
  idempotencyKey?: string;
  /** Offline device tag (online checkouts may leave it unset). */
  clientDeviceId?: string | null;
}

/**
 * CheckoutUseCase — completes a sale and deducts stock atomically (POS-15).
 *
 * The critical POS use case. Business rules:
 * - POS-3: selling requires an open shift on the register.
 * - POS-9: receipt numbers are allocated atomically and gap-free per register.
 * - POS-10/11/12/16/17/19: enforced by the Sale aggregate.
 * - POS-15: stock deduction happens through INVENTORY_STOCK_PORT inside the
 *   SAME transaction as the sale insert — if stock fails, the sale fails.
 * - POS-26: a retried checkout with the same idempotency key returns the
 *   original sale, never a duplicate.
 */
@Injectable()
export class CheckoutUseCase {
  private stockPort: InventoryStockPort | null = null;

  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
    private readonly portRegistry: PortRegistry,
  ) {}

  /**
   * Level 3 port — resolved LAZILY on first use (POS-15). The inventory
   * module registers the implementation during its `onModuleInit`, which Nest
   * runs AFTER every provider has been constructed; resolving in the
   * constructor would throw `INVENTORY_STOCK_PORT is not registered` at boot.
   */
  private getStockPort(): InventoryStockPort {
    this.stockPort ??= this.portRegistry.resolve<InventoryStockPort>(INVENTORY_STOCK_PORT);
    return this.stockPort;
  }

  async execute(input: CheckoutInput): Promise<{ saleId: string; receiptNumber: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      // POS-26: a retried checkout returns the original sale, never a duplicate.
      if (input.idempotencyKey) {
        const existing = await this.repo.findSaleByIdempotencyKey(input.idempotencyKey, tx);
        if (existing) {
          return { saleId: existing.id, receiptNumber: existing.receiptNumber, event: null };
        }
      }

      // POS-3: selling requires an open shift on the register.
      const register = await this.repo.findRegisterById(input.registerId, tx);
      if (!register) throw new NotFoundError('POS_REGISTER_NOT_FOUND', { registerId: input.registerId });
      const registerEntity = Register.fromPersistence(register);
      registerEntity.assertSellable();

      const shift = await this.repo.findOpenShiftByRegister(input.registerId, tx);
      if (!shift) {
        throw new PosError(POS_ERROR_CODE.NO_OPEN_SHIFT, 'Selling requires an open shift on the register (POS-3).', {
          registerId: input.registerId,
        });
      }

      // POS-9: atomic, gap-free receipt number allocation.
      const sequence = await this.repo.allocateReceiptNumber(input.registerId, tx);
      const receiptNumber = registerEntity.formatReceiptNumber(sequence);

      const sale = Sale.create({
        id: crypto.randomUUID(),
        organizationId,
        shiftId: shift.id,
        registerId: input.registerId,
        receiptNumber,
        currency: input.currency,
        locale: input.locale,
        lines: input.lines,
        payments: input.payments,
        soldAt: now,
        createdAt: now,
        createdBy: userId,
        ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.clientDeviceId !== undefined && input.clientDeviceId !== null
          ? { clientDeviceId: input.clientDeviceId }
          : {}),
        syncedAt: now, // online sales are synced at creation (POS-27)
        ...(input.customerContactId !== undefined && input.customerContactId !== null
          ? { customerContactId: input.customerContactId }
          : {}),
      });

      // POS-15: deduct stock in the SAME transaction as the sale. If any line
      // fails availability (INVENTORY_INSUFFICIENT_STOCK), the whole tx rolls
      // back — a sale is never recorded without its stock effect.
      const txRef = this.txManager.ref(tx);
      for (const line of sale.lines) {
        const reservation = await this.getStockPort().reserve(
          {
            variantId: line.variantId,
            warehouseId: register.warehouseId,
            quantity: line.quantity,
            referenceType: 'pos_sale',
            referenceId: sale.id,
          },
          txRef,
        );
        // Pass our UnitOfWork as the movement-event collector: inventory
        // registers inventory.stock.movement_recorded.v1 on it, so the GL gets
        // the sale movement AFTER our commit (ACC-15) — alongside pos.sale.completed.
        await this.getStockPort().commitReservation(reservation.reservationId, txRef, this.unitOfWork);
      }

      await this.repo.insertSale(sale.toJSON(), tx);

      const payload: PosSaleCompletedV1 = {
        organizationId,
        saleId: sale.id,
        shiftId: sale.shiftId,
        registerId: sale.registerId,
        receiptNumber,
        subtotalAmountMinor: sale.subtotalAmountMinor,
        discountAmountMinor: sale.discountAmountMinor,
        taxAmountMinor: sale.taxAmountMinor,
        totalAmountMinor: sale.totalAmountMinor,
        currency: sale.currency,
        lineCount: sale.lines.length,
        customerContactId: sale.customerContactId,
        locale: sale.locale,
        soldAt: sale.soldAt.toISOString(),
        occurredAt: now.toISOString(),
      };
      const event = {
        name: POS_EVENTS.SALE_COMPLETED_V1,
        payload,
        aggregateId: sale.id,
      } satisfies Parameters<UnitOfWork['addEvent']>[0];

      return { saleId: sale.id, receiptNumber, event };
    });

    if (committed.event) {
      this.unitOfWork.addEvent(committed.event);
      await this.unitOfWork.publishEvents();
    }
    return { saleId: committed.saleId, receiptNumber: committed.receiptNumber };
  }
}
