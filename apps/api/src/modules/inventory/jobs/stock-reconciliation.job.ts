import { Inject, Injectable } from '@nestjs/common';

import type { IJobQueue } from '../../../core/jobs/job-queue.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { compareQuantity } from '../domain/index.js';
import { INVENTORY_REPOSITORY, type InventoryRepository } from '../application/ports/index.js';

/** Job type for the nightly projection reconciliation (INV-2). */
export const STOCK_RECONCILIATION_JOB = 'inventory.stock-reconciliation';

/**
 * StockReconciliationJob — INV-2: the ledger is the source of truth; the
 * projection (inv_stock_levels) is derived. This job re-derives every
 * (variant, warehouse) projection from the SUM of movements and repairs any
 * drift, then re-applies the reserved quantities from held reservations.
 *
 * Runs nightly per organization.
 */
@Injectable()
export class StockReconciliationJob {
  constructor(
    @Inject('JOB_QUEUE')
    private readonly queue: IJobQueue,
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  /** Enqueue a run for one organization (called by the scheduler/init). */
  async schedule(organizationId: string, userId?: string): Promise<void> {
    await this.queue.add(STOCK_RECONCILIATION_JOB, {}, { organizationId, ...(userId ? { userId } : {}) });
  }

  /** Process one enqueued reconciliation run. */
  async process(jobId: string): Promise<{ repaired: number }> {
    const job = await this.queue.getStatus(jobId);
    if (!job?.organizationId) {
      await this.queue.fail(jobId, 'missing organizationId');
      return { repaired: 0 };
    }

    const { organizationId } = job;
    try {
      const repaired = await TenantContext.run(
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
            const sums = await this.repo.sumMovementsByVariantWarehouse(tx);
            // INV-2 must reconcile EVERY level, not a page — pass `all`.
            const { items: current } = await this.repo.listStockLevels({ all: true }, tx);
            const currentByKey = new Map(current.map((l) => [`${l.variantId}:${l.warehouseId}`, l]));

            let repaired = 0;
            for (const sum of sums) {
              const existing = currentByKey.get(`${sum.variantId}:${sum.warehouseId}`);
              const onHand = existing?.quantityOnHand ?? '0';
              // Reserved quantities come from held reservations; listStockLevels
              // already joins them, so preserve what the projection has.
              const reserved = existing?.quantityReserved ?? '0';

              // Repair drift: on-hand must equal the ledger SUM (INV-2).
              if (compareQuantity(onHand, sum.total) !== 0) {
                await this.repo.upsertStockLevel(
                  sum.variantId,
                  sum.warehouseId,
                  sum.total,
                  reserved,
                  existing?.lastMovementId ?? null,
                  tx,
                );
                repaired++;
              }
            }
            return repaired;
          }),
      );
      await this.queue.complete(jobId);
      return { repaired };
    } catch (error) {
      await this.queue.fail(jobId, error instanceof Error ? error.message : String(error));
      return { repaired: 0 };
    }
  }
}
