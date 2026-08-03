import { CrmError, CRM_ERROR_CODE } from './errors.js';

/** Activity type (crm_activities.type — DB CHECK). */
export type ActivityType = 'call' | 'meeting' | 'task' | 'email';

/**
 * Persisted shape of a CRM activity (crm_activities).
 */
export interface ActivityData {
  id: string;
  organizationId: string;
  type: ActivityType;
  subject: string;
  dueAt: Date | null;
  completedAt: Date | null;
  relatedType: string | null;
  relatedId: string | null;
  assignedTo: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
}

/**
 * Activity — a call, meeting, task, or email log attached to a contact,
 * company, or deal.
 *
 * Pure TypeScript, no framework imports (hard rule #7).
 *
 * Business rules enforced here:
 * - CRM-13: completing an activity sets `completed_at`; a completed activity
 *   cannot be edited except to append notes (the schema stores notes in the
 *   polymorphic `crm_notes` table — the append happens there, never on the
 *   activity row itself).
 * - CRM-14: activity assignment is limited to active members of the same
 *   organization. The use case passes the org's active member ids (from the
 *   memberships read port); the domain rejects anything outside that set.
 */
export class Activity {
  private constructor(private readonly data: ActivityData) {}

  static create(data: ActivityData): Activity {
    assertRelatedPair(data);
    return new Activity({ ...data });
  }

  /** Reconstruct from persistence (already valid — no invariant re-check). */
  static fromPersistence(data: ActivityData): Activity {
    return new Activity(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get type(): ActivityType {
    return this.data.type;
  }
  get subject(): string {
    return this.data.subject;
  }
  get dueAt(): Date | null {
    return this.data.dueAt;
  }
  get completedAt(): Date | null {
    return this.data.completedAt;
  }
  get relatedType(): string | null {
    return this.data.relatedType;
  }
  get relatedId(): string | null {
    return this.data.relatedId;
  }
  get assignedTo(): string | null {
    return this.data.assignedTo;
  }
  get deletedAt(): Date | null {
    return this.data.deletedAt;
  }

  /** Get all data as a plain object. */
  toJSON(): ActivityData {
    return { ...this.data };
  }

  // ─── Behaviour ──────────────────────────────────────────────────────────────

  /**
   * CRM-13: marks the activity completed.
   * Completing an already-completed activity is a no-op (idempotent — safe
   * for event-handler retries, OPS-2).
   */
  complete(at = new Date()): void {
    if (this.data.completedAt === null) {
      this.data.completedAt = at;
      this.data.updatedAt = at;
    }
  }

  /**
   * CRM-13: edits an activity.
   *
   * A completed activity cannot be edited at all — the only permitted change
   * after completion is *appending notes*, which the schema models as new rows
   * in `crm_notes` (related_type='activity'), not as an edit to the activity.
   *
   * @throws {CrmError} `CRM_ACTIVITY_COMPLETED_IMMUTABLE`
   */
  update(props: {
    type?: ActivityType;
    subject?: string;
    dueAt?: Date | null;
    relatedType?: string | null;
    relatedId?: string | null;
    updatedBy: string;
  }): void {
    if (this.data.completedAt !== null) {
      throw new CrmError(
        CRM_ERROR_CODE.ACTIVITY_COMPLETED_IMMUTABLE,
        'A completed activity cannot be edited. Notes may be appended to it instead.',
      );
    }
    const next = {
      ...this.data,
      type: props.type ?? this.data.type,
      subject: props.subject ?? this.data.subject,
      dueAt: props.dueAt === undefined ? this.data.dueAt : props.dueAt,
      relatedType: props.relatedType === undefined ? this.data.relatedType : props.relatedType,
      relatedId: props.relatedId === undefined ? this.data.relatedId : props.relatedId,
      updatedBy: props.updatedBy,
      updatedAt: new Date(),
    };
    assertRelatedPair(next);
    Object.assign(this.data, next);
  }

  /**
   * CRM-14: assigns the activity to a member.
   *
   * `activeMemberIds` must be the ids of *active members of the same
   * organization* (queried through the memberships read port) — the domain
   * rejects any id outside that set. Passing null unassigns.
   *
   * Reassignment is an edit, so it is also subject to CRM-13: a completed
   * activity cannot be reassigned either (only notes may be appended).
   *
   * @throws {CrmError} `CRM_ACTIVITY_ASSIGNEE_NOT_ACTIVE_MEMBER`
   */
  assignTo(userId: string | null, activeMemberIds: ReadonlySet<string>): void {
    if (this.data.completedAt !== null) {
      throw new CrmError(
        CRM_ERROR_CODE.ACTIVITY_COMPLETED_IMMUTABLE,
        'A completed activity cannot be reassigned. Notes may be appended to it instead.',
      );
    }
    if (userId !== null && !activeMemberIds.has(userId)) {
      throw new CrmError(
        CRM_ERROR_CODE.ACTIVITY_ASSIGNEE_NOT_ACTIVE,
        'An activity can only be assigned to an active member of the organization.',
        { userId },
      );
    }
    this.data.assignedTo = userId;
    this.data.updatedAt = new Date();
  }

  /** Soft-delete (CRM-11 pattern for contacts; activities follow the same). */
  markDeleted(by: string, at = new Date()): void {
    this.data.deletedAt = at;
    this.data.updatedBy = by;
    this.data.updatedAt = at;
  }
}

/**
 * crm_activities.related is a pair: both null or both set (DB CHECK).
 */
function assertRelatedPair(data: ActivityData): void {
  const hasType = data.relatedType !== null;
  const hasId = data.relatedId !== null;
  if (hasType !== hasId) {
    throw new CrmError(
      CRM_ERROR_CODE.ACTIVITY_RELATED_PAIR,
      'relatedType and relatedId must be set together or both left null.',
    );
  }
}
