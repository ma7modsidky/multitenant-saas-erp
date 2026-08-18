import { PURCHASING_EVENTS, purchasingSupplierReturnApprovedV1Schema } from '@modubiz/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { TransactionManager } from '../../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../../core/database/unit-of-work.js';
import { type Event } from '../../../../core/events/event-bus.interface.js';
import { HandleEvent } from '../../../../core/events/handle-event.decorator.js';
import { EntitlementService } from '../../../../core/entitlements/entitlement.service.js';
import { TenantContext, type TenantContextData } from '../../../../core/tenancy/tenant-context.js';

import { PostJournalEntryUseCase } from '../../application/index.js';
import { EnsureDefaultChartOfAccountsUseCase } from '../../application/ensure-default-coa.use-case.js';
import { ACCOUNTING_REPOSITORY, type AccountingRepository } from '../../application/ports/index.js';
import { ACCOUNTING_ERROR_CODE, AccountingDomainError } from '../../domain/index.js';

/**
 * PurchasingSupplierReturnApprovedHandler — ACC-15: posts the debit-note
 * journal entry for an approved supplier return, idempotently keyed on
 * `returnId`.
 *
 * The entry reverses the bill's AP recognition (PUR-11):
 *   Dr AP        (2000) — the returned value (the payload carries it signed
 *                         negative in the AP direction; we take |amount|)
 *   Cr Inventory (1300) — goods lines (variantId set), at line total
 *   Cr Expense   (5100) — service lines, at line total
 * The credit split absorbs any rounding remainder so the entry is balanced.
 *
 * ACC-16/OPS-8: gated on the accounting entitlement (fail closed). TEN-6: the
 * tenant context is re-established from the payload. OPS-3: failures are
 * logged, never thrown back to the publisher.
 */
@Injectable()
export class PurchasingSupplierReturnApprovedHandler {
  private readonly logger = new Logger(PurchasingSupplierReturnApprovedHandler.name);

  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
    private readonly entitlements: EntitlementService,
    private readonly ensureCoa: EnsureDefaultChartOfAccountsUseCase,
    private readonly postJournalEntry: PostJournalEntryUseCase,
  ) {}

  @HandleEvent(PURCHASING_EVENTS.SUPPLIER_RETURN_APPROVED_V1)
  async handle(event: Event): Promise<void> {
    const parsed = purchasingSupplierReturnApprovedV1Schema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn(`purchasing.supplier_return.approved.v1 payload rejected; skipping`);
      return;
    }
    const payload = parsed.data;

    // ACC-16/OPS-8: the GL posts only when accounting is entitled.
    if (!(await this.entitlements.isEntitled(payload.organizationId, 'accounting'))) {
      this.logger.debug(`accounting not entitled for org ${payload.organizationId}; skipping return AP entry`);
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
          // ACC-15: a replayed return event must not post twice.
          const existing = await this.repo.findJournalEntryBySource('supplier_return', payload.returnId, tx);
          if (existing) return;

          // ACC-5: lazy idempotent COA ensure.
          await this.ensureCoa.execute();
          const accounts = await this.repo.listAccounts(tx);
          const codeToId = new Map(accounts.map((a) => [a.code, a.id]));
          const apAccountId = codeToId.get('2000');
          const inventoryAccountId = codeToId.get('1300');
          const expenseAccountId = codeToId.get('5100');
          if (!apAccountId || !inventoryAccountId || !expenseAccountId) {
            throw new AccountingDomainError(
              ACCOUNTING_ERROR_CODE.COA_INCOMPLETE,
              'The default chart of accounts is missing a required account (ACC-5).',
            );
          }

          // The payload carries the amount signed negative (PUR-2); the entry
          // debits AP by its absolute value.
          const amount = BigInt(payload.amountMinor) < 0n ? payload.amountMinor.slice(1) : payload.amountMinor;
          const { goodsTotal, serviceTotal } = this.splitLineTotals(payload.lines, amount);

          const lines: { accountId: string; debitAmountMinor?: string; creditAmountMinor?: string }[] = [
            { accountId: apAccountId, debitAmountMinor: amount },
          ];
          if (goodsTotal !== '0') lines.push({ accountId: inventoryAccountId, creditAmountMinor: goodsTotal });
          if (serviceTotal !== '0') lines.push({ accountId: expenseAccountId, creditAmountMinor: serviceTotal });

          const posted = await this.postJournalEntry.postInTx(
            {
              entryDate: payload.returnedAt.slice(0, 10),
              description: `Supplier return ${payload.returnNumber}`,
              currency: payload.currency,
              sourceType: 'supplier_return',
              sourceId: payload.returnId,
              // ACC-15: the return id is the idempotency key.
              idempotencyKey: payload.returnId,
              lines,
            },
            tx,
          );

          // OPS-3: the journal.posted event publishes after THIS commit.
          this.unitOfWork.addEvent(posted.event);
        });
      });
      await this.unitOfWork.publishEvents();
    } catch (error) {
      // OPS-3: never throw back into the publisher.
      this.logger.error(
        `Return AP entry failed for return ${payload.returnId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Split the returned value into goods (Inventory) vs service (Expense) credits. */
  private splitLineTotals(
    lines: Array<{ variantId?: string | null | undefined; quantity: string; unitCostAmountMinor: string }>,
    amountMinor: string,
  ): { goodsTotal: string; serviceTotal: string } {
    let goods = 0n;
    for (const line of lines) {
      const value = scaledMultiply(line.unitCostAmountMinor, line.quantity);
      if (line.variantId) goods += BigInt(value);
    }
    const total = BigInt(amountMinor);
    // The service credit absorbs any rounding remainder so the entry balances
    // exactly against the AP debit.
    const service = total > goods ? total - goods : 0n;
    return { goodsTotal: goods.toString(), serviceTotal: service.toString() };
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
