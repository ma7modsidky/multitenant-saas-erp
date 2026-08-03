import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Activity, type ActivityType } from '../domain/index.js';

import { ACTIVITY_REPOSITORY, type ActivityRepository } from './ports/index.js';

export interface CreateActivityInput {
  type: ActivityType;
  subject: string;
  dueAt?: Date | null;
  relatedType?: string | null;
  relatedId?: string | null;
  assignedToUserId?: string | null;
  /**
   * CRM-14: ids of active members of the current organization. Resolved by the
   * API layer (Step 4.6) — the domain rejects any assignee outside this set.
   * When omitted, assignment is only allowed to null (unassigned).
   */
  activeMemberIds?: ReadonlySet<string>;
}

/**
 * CreateActivityUseCase — creates a CRM activity. Owns its transaction.
 *
 * Business rules:
 * - CRM-13: activities support the full lifecycle (create → complete).
 * - CRM-14: an activity can only be assigned to an active member of the same
 *   organization (the domain rejects anything outside `activeMemberIds`).
 *
 * No event is declared for activity creation — completions may publish later.
 */
@Injectable()
export class CreateActivityUseCase {
  constructor(
    @Inject(ACTIVITY_REPOSITORY)
    private readonly activityRepo: ActivityRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: CreateActivityInput): Promise<{ activity: Activity }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const activity = Activity.create({
      id: crypto.randomUUID(),
      organizationId,
      type: input.type,
      subject: input.subject,
      dueAt: input.dueAt ?? null,
      completedAt: null,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      assignedTo: null,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
    });

    // CRM-14: validate the assignee against active members of the org.
    if (input.assignedToUserId !== undefined && input.assignedToUserId !== null) {
      activity.assignTo(input.assignedToUserId, input.activeMemberIds ?? new Set());
    }

    const result = await this.txManager.run(async (tx) => {
      const persisted = await this.activityRepo.insert(activity.toJSON(), tx);
      return { activity: Activity.fromPersistence(persisted) };
    });

    // No event is declared for creation — nothing to publish after commit.
    return result;
  }
}
