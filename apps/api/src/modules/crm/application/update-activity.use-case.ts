import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Activity, type ActivityType } from '../domain/index.js';

import { ACTIVITY_REPOSITORY, type ActivityRepository } from './ports/index.js';

export interface UpdateActivityInput {
  activityId: string;
  /** New activity type. Omitted → unchanged. */
  type?: ActivityType;
  /** New subject. Omitted → unchanged. */
  subject?: string;
  /**
   * New due date, or null to clear it. Omitted → unchanged.
   * ISO 8601 datetime, validated by the API layer.
   */
  dueAt?: Date | null;
  /**
   * New assignee, or null to unassign. Omitted → unchanged.
   */
  assignedToUserId?: string | null;
  /**
   * CRM-14: ids of active members of the current organization. Resolved by the
   * API layer (same as create) — the domain rejects any assignee outside this
   * set. When omitted, assignment is only allowed to null (unassign).
   */
  activeMemberIds?: ReadonlySet<string>;
}

/**
 * UpdateActivityUseCase — edits an activity's subject/type, extends (or
 * clears) its due date, or reassigns it. Owns its transaction. Partial update:
 * only the fields the caller set are changed.
 *
 * Business rules:
 * - CRM-13: a completed activity is immutable — only notes may be appended to
 *   it. The domain rejects any update (including reassignment) to a completed
 *   activity with `CRM_ACTIVITY_COMPLETED_IMMUTABLE`.
 * - CRM-14: an activity can only be assigned to an active member of the same
 *   organization (the domain rejects anything outside `activeMemberIds`).
 *
 * No event is declared for activity updates — nothing to publish.
 */
@Injectable()
export class UpdateActivityUseCase {
  constructor(
    @Inject(ACTIVITY_REPOSITORY)
    private readonly activityRepo: ActivityRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: UpdateActivityInput): Promise<{ activity: Activity }> {
    const userId = TenantContext.getUserId() ?? '';

    const result = await this.txManager.run(async (tx) => {
      const existing = await this.activityRepo.findById(input.activityId, tx);
      if (!existing) {
        throw new NotFoundError('ACTIVITY_NOT_FOUND', { activityId: input.activityId });
      }

      const activity = Activity.fromPersistence(existing);
      // exactOptionalPropertyTypes: only set the keys the caller provided so
      // an omitted field stays unchanged on the entity.
      const patch: {
        type?: ActivityType;
        subject?: string;
        dueAt?: Date | null;
        updatedBy: string;
      } = { updatedBy: userId };
      if (input.type !== undefined) patch.type = input.type;
      if (input.subject !== undefined) patch.subject = input.subject;
      if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
      activity.update(patch);

      // CRM-14: reassignment is an edit, so it is also subject to CRM-13
      // (completed activities are immutable) and to the active-member check.
      if (input.assignedToUserId !== undefined) {
        activity.assignTo(input.assignedToUserId, input.activeMemberIds ?? new Set());
      }

      const updated = await this.activityRepo.update(input.activityId, activity.toJSON(), tx);
      if (!updated) {
        throw new NotFoundError('ACTIVITY_NOT_FOUND', { activityId: input.activityId });
      }

      return { activity: Activity.fromPersistence(updated) };
    });

    return result;
  }
}
