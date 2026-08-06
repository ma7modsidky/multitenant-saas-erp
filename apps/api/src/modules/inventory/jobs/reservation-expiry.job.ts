import { Inject, Injectable } from '@nestjs/common';

import type { IJobQueue } from '../../../core/jobs/job-queue.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { RESERVATION_STATE, Reservation, subtractQuantity } from '../domain/index.js';
import { INVENTORY_REPOSITORY, type InventoryRepository } from '../application/ports/index.js';

/** Job type for expiring held reservations past their bound (INV-7). */
export const RESERVATION_EXPIRY_JOB = 'inventory.reservation-expiry';

/**
 * ReservationExpiryJob — INV-7: releases reservations whose hold bound has
 * passed.
 *
 * The job payload carries `organizationId` (TEN-6). Processing re-establishes
 * tenant context and, for every expired `held` reservation, marks it `expired`
 * and returns the quantity to available (reserved decreases, on-hand
 * unchanged). Runs per organization — the scheduler enqueues one job per org.
 */
@Injectable()
export class ReservationExpiryJob {
  constructor(
    @Inject('JOB_QUEUE')
    private readonly queue: IJobQueue,
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  /** Enqueue a run for one organization (called by the scheduler/init). */
  async schedule(organizationId: string, userId?: string): Promise<void> {
    await this.queue.add(RESERVATION_EXPIRY_JOB, {}, { organizationId, ...(userId ? { userId } : {}) });
  }

  /** Process one enqueued expiry job. */
  async process(jobId: string): Promise<{ expired: number }> {
    const job = await this.queue.getStatus(jobId);
    if (!job?.organizationId) {
      await this.queue.fail(jobId, 'missing organizationId');
      return { expired: 0 };
    }

    const { organizationId } = job;
    try {
      const expired = await TenantContext.run(
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
            const held = await this.repo.listExpiredHeldReservations(new Date(), tx);
            let count = 0;
            for (const row of held) {
              const reservation = Reservation.fromPersistence(row);
              reservation.expire(new Date());

              // Return the quantity to available (INV-5): reserved decreases.
              const level = await this.repo.getStockLevel(reservation.variantId, reservation.warehouseId, tx);
              const newReserved = subtractQuantity(level?.quantityReserved ?? '0', reservation.quantity);
              await this.repo.upsertStockLevel(
                reservation.variantId,
                reservation.warehouseId,
                level?.quantityOnHand ?? '0',
                newReserved,
                level?.lastMovementId ?? null,
                tx,
              );
              await this.repo.updateReservationState(reservation.id, RESERVATION_STATE.EXPIRED, new Date(), tx);
              count++;
            }
            return count;
          }),
      );
      await this.queue.complete(jobId);
      return { expired };
    } catch (error) {
      await this.queue.fail(jobId, error instanceof Error ? error.message : String(error));
      return { expired: 0 };
    }
  }
}
