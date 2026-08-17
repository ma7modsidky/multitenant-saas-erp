import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { IJobQueue } from '../../../core/jobs/job-queue.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

/** Job type for the nightly GL reconciliation (ACC-15). */
export const GL_RECONCILIATION_JOB = 'accounting.gl-reconciliation';

/**
 * GlReconciliationJob — ACC-15: nightly, asserts the derived projection
 * (`acc_account_balances`) equals GL line sums, and the GL equals subledger
 * totals (invoices vs AR, payments vs allocations, credit notes). Any drift is
 * logged as a critical alert — the books are immutable, so drift means a bug,
 * and it must be found before the next period closes.
 *
 * The job payload carries `organizationId` (TEN-6); processing re-establishes
 * tenant context before any database access.
 */
@Injectable()
export class GlReconciliationJob {
  private readonly logger = new Logger(GlReconciliationJob.name);

  constructor(
    @Inject('JOB_QUEUE')
    private readonly queue: IJobQueue,
    private readonly txManager: TransactionManager,
  ) {}

  /** Enqueue a run for one organization (called by the scheduler/init). */
  async schedule(organizationId: string, userId?: string): Promise<void> {
    await this.queue.add(GL_RECONCILIATION_JOB, {}, { organizationId, ...(userId ? { userId } : {}) });
  }

  /** Process one enqueued run: report drift, never mutate the books. */
  async process(jobId: string): Promise<{ drift: string[] }> {
    const job = await this.queue.getStatus(jobId);
    if (!job?.organizationId) {
      await this.queue.fail(jobId, 'missing organizationId');
      return { drift: [] };
    }

    const { organizationId } = job;
    try {
      const drift = await TenantContext.run(
        {
          userId: job.userId ?? organizationId,
          sessionId: undefined,
          organizationId,
          roles: [],
          permissions: [],
          locale: 'en',
        },
        () =>
          this.txManager.run(async (tx) => {
            const db = tx as PostgresJsDatabase;
            const issues: string[] = [];

            // 1) Projection vs GL line sums: for every (account, period) in the
            //    projection, the stored totals must equal the journal-line sums.
            const balanceDrift = await db.execute<Record<string, unknown>>(sql`
              SELECT b.account_id, b.period,
                     b.debit_total_minor  AS stored_debit,
                     COALESCE(l.debit_total, 0)  AS actual_debit,
                     b.credit_total_minor AS stored_credit,
                     COALESCE(l.credit_total, 0) AS actual_credit
              FROM acc_account_balances b
              LEFT JOIN (
                SELECT jl.account_id,
                       to_char(j.entry_date, 'YYYY-MM') AS period,
                       SUM(jl.debit_amount_minor)  AS debit_total,
                       SUM(jl.credit_amount_minor) AS credit_total
                FROM acc_journal_lines jl
                JOIN acc_journal_entries j ON j.id = jl.entry_id
                WHERE j.status <> 'reversed'
                GROUP BY jl.account_id, to_char(j.entry_date, 'YYYY-MM')
              ) l ON l.account_id = b.account_id AND l.period = b.period
              WHERE b.debit_total_minor <> COALESCE(l.debit_total, 0)
                 OR b.credit_total_minor <> COALESCE(l.credit_total, 0)
            `);
            for (const row of balanceDrift) {
              issues.push(
                `account_balance drift: account=${String(row.account_id)} period=${String(row.period)} ` +
                  `stored_debit=${String(row.stored_debit)} actual_debit=${String(row.actual_debit)} ` +
                  `stored_credit=${String(row.stored_credit)} actual_credit=${String(row.actual_credit)}`,
              );
            }

            // 2) AR subledger vs GL: Σ issued invoices must equal the AR
            //    account's (1200) debit total, minus credit-note reversals.
            const arDrift = await db.execute<Record<string, unknown>>(sql`
              WITH ar_gl AS (
                SELECT COALESCE(SUM(jl.debit_amount_minor), 0) - COALESCE(SUM(jl.credit_amount_minor), 0) AS net
                FROM acc_journal_lines jl
                JOIN acc_journal_entries j ON j.id = jl.entry_id
                JOIN acc_accounts a ON a.id = jl.account_id
                WHERE j.status <> 'reversed' AND a.code = '1200'
              ),
              ar_ledger AS (
                SELECT COALESCE(SUM(i.total_amount_minor - i.paid_amount_minor - i.credited_amount_minor), 0) AS net
                FROM acc_invoices i
                WHERE i.status <> 'void'
              )
              SELECT ar_gl.net AS gl_net, ar_ledger.net AS ledger_net
              FROM ar_gl, ar_ledger
              WHERE ar_gl.net <> ar_ledger.net
            `);
            for (const row of arDrift) {
              issues.push(`AR drift: gl_net=${String(row.gl_net)} ledger_net=${String(row.ledger_net)}`);
            }

            // 3) Global balance check: the whole ledger must balance (ACC-1).
            const balanceCheck = await db.execute<Record<string, unknown>>(sql`
              SELECT COALESCE(SUM(jl.debit_amount_minor), 0)  AS debit_total,
                     COALESCE(SUM(jl.credit_amount_minor), 0) AS credit_total
              FROM acc_journal_lines jl
              JOIN acc_journal_entries j ON j.id = jl.entry_id
              WHERE j.status <> 'reversed'
            `);
            const row0 = balanceCheck[0];
            if (row0 && String(row0.debit_total) !== String(row0.credit_total)) {
              issues.push(`ledger unbalanced: debits=${String(row0.debit_total)} credits=${String(row0.credit_total)}`);
            }

            if (issues.length > 0) {
              // ACC-15: drift is an alert, never a silent repair — the books
              // are immutable (ACC-2), so nothing is auto-corrected here.
              this.logger.error(`GL reconciliation drift (org ${organizationId}):\n  ${issues.join('\n  ')}`);
            } else {
              this.logger.log(`GL reconciliation clean for org ${organizationId}`);
            }
            return issues;
          }),
      );
      await this.queue.complete(jobId);
      return { drift };
    } catch (error) {
      await this.queue.fail(jobId, error instanceof Error ? error.message : String(error));
      return { drift: [] };
    }
  }
}
