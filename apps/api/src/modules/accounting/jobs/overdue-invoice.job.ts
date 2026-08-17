import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { IJobQueue } from '../../../core/jobs/job-queue.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { INVOICE_STATUS } from '../domain/index.js';
import { ACCOUNTING_REPOSITORY, type AccountingRepository } from '../application/ports/index.js';

/** Job type for flipping due-but-unpaid invoices to `overdue` (ACC-8). */
export const OVERDUE_INVOICE_JOB = 'accounting.overdue-invoice';

/**
 * OverdueInvoiceJob — ACC-8: `Overdue` is computed from the due date and the
 * unpaid balance by a nightly job — never a manual transition. Invoices that
 * are issued or partially_paid and whose due date has passed flip to overdue.
 *
 * The job payload carries `organizationId` (TEN-6). Processing re-establishes
 * tenant context and updates only the matching invoices — the status CHECK
 * guarantees a paid/void invoice is never touched.
 */
@Injectable()
export class OverdueInvoiceJob {
  constructor(
    @Inject('JOB_QUEUE')
    private readonly queue: IJobQueue,
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  /** Enqueue a run for one organization (called by the scheduler/init). */
  async schedule(organizationId: string, userId?: string): Promise<void> {
    await this.queue.add(OVERDUE_INVOICE_JOB, {}, { organizationId, ...(userId ? { userId } : {}) });
  }

  /** Process one enqueued run: flip due unpaid invoices to `overdue`. */
  async process(jobId: string): Promise<{ markedOverdue: number }> {
    const job = await this.queue.getStatus(jobId);
    if (!job?.organizationId) {
      await this.queue.fail(jobId, 'missing organizationId');
      return { markedOverdue: 0 };
    }

    const { organizationId } = job;
    try {
      const markedOverdue = await TenantContext.run(
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
            // ACC-8: only issued/partially_paid invoices can become overdue,
            // and only when the due date has passed with a balance due.
            const organizationId = TenantContext.requireOrganizationId();
            const db = tx as PostgresJsDatabase;
            const rows = await db.execute<Record<string, unknown>>(sql`
              SELECT id FROM acc_invoices
              WHERE organization_id = ${organizationId}
                AND status IN (${INVOICE_STATUS.ISSUED}, ${INVOICE_STATUS.PARTIALLY_PAID})
                AND due_date < CURRENT_DATE
                AND paid_amount_minor < total_amount_minor
            `);
            const ids = rows.map((r) => r.id as string);
            for (const id of ids) {
              await this.repo.updateInvoiceStatus(id, INVOICE_STATUS.OVERDUE, tx);
            }
            return ids.length;
          }),
      );
      await this.queue.complete(jobId);
      return { markedOverdue };
    } catch (error) {
      await this.queue.fail(jobId, error instanceof Error ? error.message : String(error));
      return { markedOverdue: 0 };
    }
  }
}
