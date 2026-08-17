import { INVENTORY_EVENTS, inventoryStockMovementRecordedV1Schema } from '@modubiz/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { TransactionManager } from '../../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../../core/database/unit-of-work.js';
import { type Event } from '../../../../core/events/event-bus.interface.js';
import { HandleEvent } from '../../../../core/events/handle-event.decorator.js';
import { EntitlementService } from '../../../../core/entitlements/entitlement.service.js';
import { TenantContext, type TenantContextData } from '../../../../core/tenancy/tenant-context.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from '../../application/ports/index.js';
import { PostJournalEntryUseCase } from '../../application/index.js';
import { EnsureDefaultChartOfAccountsUseCase } from '../../application/ensure-default-coa.use-case.js';
import { ACCOUNTING_ERROR_CODE, AccountingDomainError } from '../../domain/index.js';

/**
 * InventoryMovementRecordedHandler — ACC-15: posts the inventory-side GL entry
 * for stock movements, idempotently keyed on the movement id.
 *
 * Posting matrix (Phase 7 scope — the purchase-side paths arrive with Phase 8):
 *   - `sale`           → Dr COGS (5000) / Cr Inventory (1300) at the movement's
 *                        snapshot unit cost × |qty|. Covers POS sales and
 *                        goods-invoice issuance (ACC-14).
 *   - `return`         → Dr Inventory / Cr COGS (restock reverses the sale).
 *   - `cost_adjustment`→ Dr/Cr Inventory by the signed value delta (PUR-9),
 *                        balanced against COGS. Quantity is 0 (INV-3 exemption).
 *   - everything else  → skipped with a logged note: `receipt` and
 *                        `supplier_return` belong to Phase 8's bill/return
 *                        handlers (Dr Inventory / Cr AP); `transfer_*` moves
 *                        value between warehouses without changing total
 *                        inventory; `adjustment`/`count_correction`/`write_off`
 *                        are covered by their owning module's events.
 *
 * Idempotency: the journal entry's idempotency key IS the movement id, and the
 * source reference is (stock_movement, movementId) — a replayed event is a
 * no-op (ACC-15, OPS-2). TEN-6: tenant context is re-established from the
 * payload. OPS-3: failures are logged, never thrown back to the publisher.
 */
@Injectable()
export class InventoryMovementRecordedHandler {
  private readonly logger = new Logger(InventoryMovementRecordedHandler.name);

  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
    private readonly entitlements: EntitlementService,
    private readonly ensureCoa: EnsureDefaultChartOfAccountsUseCase,
    private readonly postJournalEntry: PostJournalEntryUseCase,
  ) {}

  @HandleEvent(INVENTORY_EVENTS.MOVEMENT_RECORDED_V1)
  async handle(event: Event): Promise<void> {
    const parsed = inventoryStockMovementRecordedV1Schema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn(`inventory.stock.movement_recorded.v1 payload rejected; skipping`);
      return;
    }
    const payload = parsed.data;

    // The mapping table in the class doc only covers sale/return/cost_adjustment.
    if (!['sale', 'return', 'cost_adjustment'].includes(payload.movementType)) {
      return;
    }

    // ACC-16/OPS-8: the GL posts only when accounting is entitled.
    if (!(await this.entitlements.isEntitled(payload.organizationId, 'accounting'))) {
      this.logger.debug(`accounting not entitled for org ${payload.organizationId}; skipping movement GL`);
      return;
    }

    const context: TenantContextData = {
      userId: 'system',
      sessionId: undefined,
      organizationId: payload.organizationId,
      roles: [],
      permissions: [],
      locale: 'en',
    };

    try {
      await TenantContext.run(context, async () => {
        await this.txManager.run(async (tx) => {
          // ACC-15: a replayed movement must not post twice.
          const existing = await this.repo.findJournalEntryBySource('stock_movement', payload.movementId, tx);
          if (existing) return;

          // ACC-5: lazy idempotent COA ensure (first movement seeds the chart).
          await this.ensureCoa.execute();
          const accounts = await this.repo.listAccounts(tx);
          const codeToId = new Map(accounts.map((a) => [a.code, a.id]));
          const inventoryAccountId = codeToId.get('1300');
          const cogsAccountId = codeToId.get('5000');
          if (!inventoryAccountId || !cogsAccountId) {
            throw new AccountingDomainError(
              ACCOUNTING_ERROR_CODE.COA_INCOMPLETE,
              'The default chart of accounts is missing a required account (ACC-5).',
            );
          }

          const lines = this.buildLines(payload, inventoryAccountId, cogsAccountId);
          if (!lines) return; // nothing to post (e.g. zero value)

          await this.postJournalEntry.postInTx(
            {
              entryDate: payload.occurredAt.slice(0, 10),
              description: `Stock ${payload.movementType} ${payload.referenceType}`,
              // The movement's cost currency — every GL entry is single-currency
              // (ACC-4). Movements without a cost carry a NULL currency and are
              // filtered out above (buildLines returns null), so this is safe.
              currency: payload.unitCostCurrency ?? 'USD',
              sourceType: 'stock_movement',
              sourceId: payload.movementId,
              // ACC-15: the movement id is the idempotency key.
              idempotencyKey: payload.movementId,
              lines,
            },
            tx,
          );
        });
      });
    } catch (error) {
      // OPS-3: never throw back into the publisher.
      this.logger.error(
        `Movement GL failed for movement ${payload.movementId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Build the balanced Dr/Cr lines for the movement, or null when no entry. */
  private buildLines(
    payload: { movementType: string; quantity: string; unitCostAmountMinor: string | null },
    inventoryAccountId: string,
    cogsAccountId: string,
  ): { accountId: string; debitAmountMinor?: string; creditAmountMinor?: string }[] | null {
    if (payload.movementType === 'cost_adjustment') {
      // quantity is 0; the cost column carries the SIGNED total value delta.
      const delta = payload.unitCostAmountMinor ?? '0';
      if (delta === '0') return null;
      const abs = delta.startsWith('-') ? delta.slice(1) : delta;
      return delta.startsWith('-')
        ? [
            { accountId: cogsAccountId, debitAmountMinor: abs },
            { accountId: inventoryAccountId, creditAmountMinor: abs },
          ]
        : [
            { accountId: inventoryAccountId, debitAmountMinor: abs },
            { accountId: cogsAccountId, creditAmountMinor: abs },
          ];
    }

    // sale / return: value = |qty| × unit cost, rounded half-up (hard rule #3).
    const unitCost = payload.unitCostAmountMinor;
    if (!unitCost || unitCost === '0') return null;
    const qty = payload.quantity.startsWith('-') ? payload.quantity.slice(1) : payload.quantity;
    const value = scaledMultiply(unitCost, qty);
    if (value === '0') return null;

    // sale: Dr COGS / Cr Inventory. return (restock): the reverse.
    const isReturn = payload.movementType === 'return';
    return isReturn
      ? [
          { accountId: inventoryAccountId, debitAmountMinor: value },
          { accountId: cogsAccountId, creditAmountMinor: value },
        ]
      : [
          { accountId: cogsAccountId, debitAmountMinor: value },
          { accountId: inventoryAccountId, creditAmountMinor: value },
        ];
  }
}

/** exact value = unitCost × qty(4dp), rounded half-up — minor units (hard rule #3). */
function scaledMultiply(unitCostMinor: string, quantity: string): string {
  const qty = parseDecimalScaled(quantity);
  const gross = BigInt(unitCostMinor) * qty;
  return ((gross + 5000n) / 10000n).toString();
}

/** Parse a decimal string (e.g. "3.5000") into ×10⁴ integer units. */
function parseDecimalScaled(value: string): bigint {
  const [whole = '0', frac = '0'] = value.split('.');
  const fracPadded = frac.padEnd(4, '0').slice(0, 4);
  return BigInt(whole) * 10000n + BigInt(fracPadded);
}
