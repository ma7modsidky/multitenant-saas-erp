import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Activity } from '../domain/index.js';

import { ACTIVITY_REPOSITORY, type ActivityRepository } from './ports/index.js';

export interface CompleteActivityInput {
  activityId: string;
}

/**
 * CompleteActivityUseCase — marks an activity completed. Owns its transaction.
 *
 * Business rules:
 * - CRM-13: completing sets `completed_at`; a completed activity becomes
 *   immutable (except appended notes). Completing an already-completed
 *   activity is an idempotent no-op (safe for event-handler retries, OPS-2).
 *
 * No event is declared for activity completion — nothing to publish.
 */
@Injectable()
export class CompleteActivityUseCase {
  constructor(
    @Inject(ACTIVITY_REPOSITORY)
    private readonly activityRepo: ActivityRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: CompleteActivityInput): Promise<{ activity: Activity }> {
    const result = await this.txManager.run(async (tx) => {
      const existing = await this.activityRepo.findById(input.activityId, tx);
      if (!existing) {
        throw new NotFoundError('ACTIVITY_NOT_FOUND', { activityId: input.activityId });
      }

      const activity = Activity.fromPersistence(existing);
      activity.complete(new Date());

      const updated = await this.activityRepo.update(input.activityId, activity.toJSON(), tx);
      if (!updated) {
        throw new NotFoundError('ACTIVITY_NOT_FOUND', { activityId: input.activityId });
      }

      return { activity: Activity.fromPersistence(updated) };
    });

    return result;
  }
}
