import { INVENTORY_STOCK_PORT, POS_EVENTS, type InventoryStockPort, type PosSaleCompletedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { PosError, POS_ERROR_CODE, Register, Sale, type PaymentInput, type SaleLineInput } from '../domain/index.js';

import { POS_REPOSITORY, type PosRepository } from './ports/index.js';
import { DefaultTaxRateResolver } from './default-tax-rate.resolver.js';

export interface SyncOfflineSaleInput {
  /** POS-29: the device the sale was completed on. */
  clientDeviceId: string;
  /** POS-26: client-generated UUID — the idempotency key. */
  idempotencyKey: string;
  registerId: string;
  /** The register currency = the org base currency (POS-11). */
  currency: string;
  locale: string;
  /** POS-27: when the sale physically happened (server assigns the receipt). */
  soldAt: string;
  lines: SaleLineInput[];
  payments: PaymentInput[];
  customerContactId?: string | null;
}

/**
 * SyncOfflineSaleUseCase — server half of the offline-first flow (POS-25..29).
 *
 * Business rules:
 * - POS-26: `UNIQUE (organization_id, idempotency_key)` — a replay returns the
 *   original sale with its authoritative receipt, never a duplicate.
 * - POS-27: receipt numbers for offline sales are provisional client-side; the
 *   server assigns the authoritative number at sync.
 * - POS-29: every sync attempt is recorded in pos_sync_log with its outcome
 *   (accepted / duplicate / rejected).
 *
 * NOTE (POS-28): syncing stock effects that would drive stock NEGATIVE is
 * deferred with the offline client work — for now an over-available sync is
 * rejected (recorded as `rejected`), which can never corrupt the books. The
 * accept-and-alert path lands with the PWA outbox.
 */
@Injectable()
export class SyncOfflineSaleUseCase {
  private stockPort: InventoryStockPort | null = null;

  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
    private readonly portRegistry: PortRegistry,
    private readonly defaultTaxRate: DefaultTaxRateResolver,
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

  async execute(input: SyncOfflineSaleInput): Promise<SyncOfflineSaleResult> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    let committed;
    try {
      committed = await this.txManager.run(async (tx) => {
        // POS-26: a replay returns the original sale, never a duplicate.
        const existing = await this.repo.findSaleByIdempotencyKey(input.idempotencyKey, tx);
        if (existing) {
          await this.repo.insertSyncLog(
            {
              organizationId,
              clientDeviceId: input.clientDeviceId,
              idempotencyKey: input.idempotencyKey,
              payload: { replay: true },
              result: 'duplicate',
              errorCode: null,
            },
            tx,
          );
          return {
            saleId: existing.id,
            receiptNumber: existing.receiptNumber,
            replay: true,
            rejected: false,
            errorCode: null,
            event: null,
          };
        }

        // POS-3: syncing a sale still requires an open shift on the register.
        const register = await this.repo.findRegisterById(input.registerId, tx);
        if (!register) throw new NotFoundError('POS_REGISTER_NOT_FOUND', { registerId: input.registerId });
        const shift = await this.repo.findOpenShiftByRegister(input.registerId, tx);
        if (!shift) {
          throw new PosError(POS_ERROR_CODE.NO_OPEN_SHIFT, 'Selling requires an open shift on the register (POS-3).', {
            registerId: input.registerId,
          });
        }

        // POS-15: stock effects are applied FIRST (POS-28 rejects an
        // over-available sync). A stock failure THROWS OUT of this transaction
        // — every earlier line's reservation + commit rolls back with it, so a
        // rejected sync can never leave partial stock deductions (POS-15 is
        // atomic even in the rejected direction). The receipt number is not yet
        // allocated, so no gap appears in the sequence (POS-9).
        const saleId = crypto.randomUUID();
        const txRef = this.txManager.ref(tx);
        for (const line of input.lines) {
          const reservation = await this.getStockPort().reserve(
            {
              variantId: line.variantId,
              warehouseId: register.warehouseId,
              quantity: line.quantity,
              referenceType: 'pos_sale',
              referenceId: saleId,
            },
            txRef,
          );
          // Pass our UnitOfWork as the movement-event collector (ACC-15):
          // inventory registers movement_recorded on it, published after commit.
          await this.getStockPort().commitReservation(reservation.reservationId, txRef, this.unitOfWork);
        }

        // POS-27: the server assigns the authoritative receipt number, only now
        // that the stock effect is guaranteed to land.
        const sequence = await this.repo.allocateReceiptNumber(input.registerId, tx);
        const receiptNumber = Register.fromPersistence(register).formatReceiptNumber(sequence);

        // POS-17: apply the org's default tax rate to unrated lines (ACC-11 via
        // TAX_RATE_READ_PORT) — the offline client hardcodes taxRateBp 0.
        const lines = await this.resolveLineTaxes(input.lines);

        const sale = Sale.create({
          id: saleId,
          organizationId,
          shiftId: shift.id,
          registerId: input.registerId,
          receiptNumber,
          currency: input.currency,
          locale: input.locale,
          lines,
          payments: input.payments,
          soldAt: new Date(input.soldAt),
          createdAt: now,
          createdBy: userId,
          idempotencyKey: input.idempotencyKey,
          clientDeviceId: input.clientDeviceId,
          // POS-27: this IS the sync — the sale is now synced.
          syncedAt: now,
          ...(input.customerContactId !== undefined && input.customerContactId !== null
            ? { customerContactId: input.customerContactId }
            : {}),
        });
        const saleData = sale.toJSON();

        await this.repo.insertSale(saleData, tx);
        await this.repo.insertSyncLog(
          {
            organizationId,
            clientDeviceId: input.clientDeviceId,
            idempotencyKey: input.idempotencyKey,
            payload: { saleId: sale.id, receiptNumber },
            result: 'accepted',
            errorCode: null,
          },
          tx,
        );

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

        return { saleId: sale.id, receiptNumber, replay: false, rejected: false, errorCode: null, event };
      });
    } catch (error) {
      // POS-28/POS-29: an over-available sync is REJECTED — the sale
      // transaction above rolled back (no partial stock deductions, no burned
      // receipt), and the attempt is recorded in pos_sync_log as `rejected` in
      // its OWN transaction. Only genuine stock rejections are classified this
      // way; anything else (transient DB failure, unknown variant, ...) is
      // rethrown so the client sees a 5xx/4xx, not a misleading log entry.
      const errorCode = (error as { code?: string }).code;
      if (!isStockRejection(errorCode)) {
        throw error;
      }
      await this.txManager.run((tx) =>
        this.repo.insertSyncLog(
          {
            organizationId,
            clientDeviceId: input.clientDeviceId,
            idempotencyKey: input.idempotencyKey,
            payload: { rejected: true, error: errorCode },
            result: 'rejected',
            errorCode,
          },
          tx,
        ),
      );
      return { saleId: null, receiptNumber: null, replay: false, rejected: true, errorCode };
    }

    if (committed.event) {
      this.unitOfWork.addEvent(committed.event);
      await this.unitOfWork.publishEvents();
    }
    return {
      saleId: committed.saleId,
      receiptNumber: committed.receiptNumber,
      replay: committed.replay,
      rejected: committed.rejected,
      errorCode: committed.errorCode,
    };
  }

  /** POS-17: resolve each line's effective tax rate (default-rate fallback). */
  private async resolveLineTaxes(lines: SaleLineInput[]): Promise<SaleLineInput[]> {
    let defaultRateBp = 0;
    let defaultResolved = false;
    return Promise.all(
      lines.map(async (line) => {
        if (line.taxRateBp > 0) return line;
        if (!defaultResolved) {
          defaultRateBp = await this.defaultTaxRate.resolveTaxRateBp(0);
          defaultResolved = true;
        }
        return { ...line, taxRateBp: defaultRateBp };
      }),
    );
  }
}

/**
 * Type guard: true when an error code represents the POS-28 oversold
 * condition, which the server classifies as a `rejected` sync (recorded in
 * pos_sync_log so the client keeps the attempt in its outbox). Deliberately
 * NARROW: only the stock-availability rejection is a business `rejected`
 * outcome. Everything else — a transient DB failure, an unknown variant or
 * register (`NOT_FOUND`), a payload error — rethrows so the client sees a
 * 4xx/5xx and can fix the payload rather than looping on a misleading log
 * entry. The guard also narrows `code` to `string` so the rejected log row's
 * `errorCode` column stays non-null.
 */
function isStockRejection(code: string | undefined): code is string {
  return code === 'INVENTORY_INSUFFICIENT_STOCK';
}

/** Result of a sync attempt — POS-28/29: rejected syncs are recorded, never dropped. */
export interface SyncOfflineSaleResult {
  /** The synced sale (null when the sync was rejected). */
  saleId: string | null;
  /** The server-assigned authoritative receipt (null when rejected). */
  receiptNumber: string | null;
  /** true when this call was a replay of an already-synced sale (POS-26). */
  replay: boolean;
  /** true when the sync was rejected (e.g. over-available stock, POS-28). */
  rejected: boolean;
  /** The machine-readable rejection code (e.g. INVENTORY_INSUFFICIENT_STOCK). */
  errorCode: string | null;
}
