import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { IJobQueue } from '../../../core/jobs/job-queue.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

/** Job type for polling e-invoice provider status (ACC-12). */
export const E_INVOICE_STATUS_JOB = 'accounting.e-invoice-status';

/**
 * EInvoiceStatusJob — ACC-12: polls the configured compliance provider
 * (ZATCA Phase 2 / Egyptian ETA) for invoices stuck in `submitted`.
 *
 * Phase 7 ships the columns and the polling cadence; adapters plug in behind
 * a provider port (per-region). Without an adapter for the org's configured
 * provider, the job logs an operational alert instead of fabricating a
 * compliance state — a missing provider never blocks issuance, only marking
 * (ACC-12). The job payload carries `organizationId` (TEN-6).
 */
@Injectable()
export class EInvoiceStatusJob {
  private readonly logger = new Logger(EInvoiceStatusJob.name);

  constructor(
    @Inject('JOB_QUEUE')
    private readonly queue: IJobQueue,
    private readonly txManager: TransactionManager,
  ) {}

  /** Enqueue a run for one organization (called by the scheduler/init). */
  async schedule(organizationId: string, userId?: string): Promise<void> {
    await this.queue.add(E_INVOICE_STATUS_JOB, {}, { organizationId, ...(userId ? { userId } : {}) });
  }

  /** Process one enqueued run. */
  async process(jobId: string): Promise<{ pending: number; alert: string | null }> {
    const job = await this.queue.getStatus(jobId);
    if (!job?.organizationId) {
      await this.queue.fail(jobId, 'missing organizationId');
      return { pending: 0, alert: null };
    }

    const { organizationId } = job;
    try {
      const result = await TenantContext.run(
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
            const providerRows = await db.execute<Record<string, unknown>>(sql`
              SELECT e_invoice_provider FROM acc_org_settings
              WHERE organization_id = ${organizationId}
            `);
            const provider = (providerRows[0]?.e_invoice_provider as string | undefined) ?? 'none';

            const pendingRows = await db.execute<Record<string, unknown>>(sql`
              SELECT id, e_invoice_hash FROM acc_invoices
              WHERE e_invoice_status = 'submitted'
            `);
            const pending = pendingRows.length;
            if (pending === 0) return { pending: 0, alert: null };

            if (provider === 'none') {
              // No provider configured — nothing to poll. Invoices stay
              // 'submitted' until an adapter is configured (ACC-12).
              return { pending, alert: null };
            }

            // Adapters (zatca/eta) plug in behind a provider port in a later
            // phase. Until one is registered for this provider, surface an
            // operational alert rather than fabricating compliance.
            const alert = `No e-invoice adapter registered for provider '${provider}' (org ${organizationId}); ${pending} invoice(s) remain submitted (ACC-12).`;
            this.logger.warn(alert);
            return { pending, alert };
          }),
      );
      await this.queue.complete(jobId);
      return result;
    } catch (error) {
      await this.queue.fail(jobId, error instanceof Error ? error.message : String(error));
      return { pending: 0, alert: null };
    }
  }
}
