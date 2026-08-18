import { PURCHASING_EVENTS, purchasingPaymentRecordedV1Schema } from '@modubiz/contracts';
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
 * PurchasingPaymentRecordedHandler — ACC-15: posts the AP settlement journal
 * entry for a recorded supplier payment, idempotently keyed on `paymentId`.
 *
 * The entry settles AP against the cash accounts:
 *   Dr AP   (2000) — payment amount
 *   Cr Cash (1000) — when the payment method is `cash`
 *   Cr Bank (1100) — bank_transfer / card / cheque / other
 *
 * ACC-16/OPS-8: gated on the accounting entitlement (fail closed). TEN-6: the
 * tenant context is re-established from the payload. OPS-3: failures are
 * logged, never thrown back to the publisher.
 */
@Injectable()
export class PurchasingPaymentRecordedHandler {
  private readonly logger = new Logger(PurchasingPaymentRecordedHandler.name);

  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
    private readonly entitlements: EntitlementService,
    private readonly ensureCoa: EnsureDefaultChartOfAccountsUseCase,
    private readonly postJournalEntry: PostJournalEntryUseCase,
  ) {}

  @HandleEvent(PURCHASING_EVENTS.PAYMENT_RECORDED_V1)
  async handle(event: Event): Promise<void> {
    const parsed = purchasingPaymentRecordedV1Schema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn(`purchasing.payment.recorded.v1 payload rejected; skipping`);
      return;
    }
    const payload = parsed.data;

    // ACC-16/OPS-8: the GL posts only when accounting is entitled.
    if (!(await this.entitlements.isEntitled(payload.organizationId, 'accounting'))) {
      this.logger.debug(`accounting not entitled for org ${payload.organizationId}; skipping payment AP entry`);
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
          // ACC-15: a replayed payment event must not post twice.
          const existing = await this.repo.findJournalEntryBySource('supplier_payment', payload.paymentId, tx);
          if (existing) return;

          // ACC-5: lazy idempotent COA ensure (first payment AP entry seeds the chart).
          await this.ensureCoa.execute();
          const accounts = await this.repo.listAccounts(tx);
          const codeToId = new Map(accounts.map((a) => [a.code, a.id]));
          const apAccountId = codeToId.get('2000');
          // Cash settles on the Cash account; every other method draws the bank.
          const creditAccountId = payload.method === 'cash' ? codeToId.get('1000') : codeToId.get('1100');
          if (!apAccountId || !creditAccountId) {
            throw new AccountingDomainError(
              ACCOUNTING_ERROR_CODE.COA_INCOMPLETE,
              'The default chart of accounts is missing a required account (ACC-5).',
            );
          }

          const posted = await this.postJournalEntry.postInTx(
            {
              entryDate: payload.paidAt.slice(0, 10),
              description: `Supplier payment ${payload.paymentNumber}`,
              currency: payload.currency,
              sourceType: 'supplier_payment',
              sourceId: payload.paymentId,
              // ACC-15: the payment id is the idempotency key.
              idempotencyKey: payload.paymentId,
              lines: [
                { accountId: apAccountId, debitAmountMinor: payload.amountMinor },
                { accountId: creditAccountId, creditAmountMinor: payload.amountMinor },
              ],
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
        `Payment AP entry failed for payment ${payload.paymentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
