import { INVENTORY_EVENTS } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import type { IJobQueue } from '../../../core/jobs/job-queue.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { isQuantityShort, subtractQuantity } from '../domain/index.js';
import { INVENTORY_REPOSITORY, type InventoryRepository } from '../application/ports/index.js';

/** Job type for scanning stock below the reorder point (INV-13). */
export const LOW_STOCK_ALERT_JOB = 'inventory.low-stock-alert';

/**
 * LowStockAlertJob — INV-13: flags variants whose AVAILABLE stock has crossed
 * below the reorder point and publishes `inventory.reorder_point.reached.v1`.
 *
 * One open alert per (variant, warehouse) — the DB unique index prevents
 * storms. The alert is resolved when a later movement lifts stock above the
 * reorder point (ReceiveStockUseCase closes it). Per organization.
 */
@Injectable()
export class LowStockAlertJob {
  constructor(
    @Inject('JOB_QUEUE')
    private readonly queue: IJobQueue,
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  /** Enqueue a scan for one organization (called by the scheduler/init). */
  async schedule(organizationId: string, userId?: string): Promise<void> {
    await this.queue.add(LOW_STOCK_ALERT_JOB, {}, { organizationId, ...(userId ? { userId } : {}) });
  }

  /** Process one enqueued low-stock scan. */
  async process(jobId: string): Promise<{ alerts: number }> {
    const job = await this.queue.getStatus(jobId);
    if (!job?.organizationId) {
      await this.queue.fail(jobId, 'missing organizationId');
      return { alerts: 0 };
    }

    const { organizationId } = job;
    try {
      const alerts = await TenantContext.run(
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
            // INV-13 must scan EVERY level, not a page — pass `all`.
            const { items: levels } = await this.repo.listStockLevels({ all: true }, tx);
            const now = new Date();
            let alerts = 0;

            for (const level of levels) {
              // `all` reads are leveled-only (INNER join), so a level row
              // always has a warehouse — guard keeps the invariant explicit.
              if (level.warehouseId === null) continue;
              // INV-13: trigger on AVAILABLE (INV-5), never on-hand. Exact
              // decimal-string arithmetic (INV-15) — never floats.
              const available = subtractQuantity(level.quantityOnHand, level.quantityReserved);
              if (isQuantityShort(available, level.reorderPoint)) {
                await this.repo.upsertLowStockAlert(level.variantId, level.warehouseId, now, tx);
                this.unitOfWork.addEvent({
                  name: INVENTORY_EVENTS.REORDER_POINT_REACHED_V1,
                  payload: {
                    organizationId,
                    variantId: level.variantId,
                    warehouseId: level.warehouseId,
                    quantityAvailable: available,
                    reorderPoint: level.reorderPoint,
                    occurredAt: now.toISOString(),
                  },
                  aggregateId: level.variantId,
                });
                alerts++;
              }
            }
            return alerts;
          }),
      );
      await this.unitOfWork.publishEvents();
      await this.queue.complete(jobId);
      return { alerts };
    } catch (error) {
      await this.queue.fail(jobId, error instanceof Error ? error.message : String(error));
      return { alerts: 0 };
    }
  }
}
