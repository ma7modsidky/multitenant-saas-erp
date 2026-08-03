import { describe, expect, it } from 'vitest';

import { Activity, CrmError, CRM_ERROR_CODE, type ActivityData } from '../../domain/index.js';

function makeActivityData(overrides: Partial<ActivityData> = {}): ActivityData {
  return {
    id: 'activity-1',
    organizationId: 'org-1',
    type: 'call',
    subject: 'Discovery call',
    dueAt: null,
    completedAt: null,
    relatedType: null,
    relatedId: null,
    assignedTo: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

function expectCrmError(action: () => void, expectedCode: string): void {
  try {
    action();
    expect.fail('Expected CrmError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(CrmError);
    expect((error as CrmError).code).toBe(expectedCode);
  }
}

describe('CRM-13: a completed activity cannot be edited except to append notes', () => {
  it('completing an activity sets completed_at', () => {
    const activity = Activity.create(makeActivityData());
    expect(activity.completedAt).toBeNull();
    activity.complete(new Date('2026-01-05T00:00:00Z'));
    expect(activity.completedAt).toEqual(new Date('2026-01-05T00:00:00Z'));
  });

  it('is idempotent when completed twice', () => {
    const activity = Activity.create(makeActivityData());
    activity.complete(new Date('2026-01-05T00:00:00Z'));
    activity.complete(new Date('2026-01-06T00:00:00Z'));
    expect(activity.completedAt).toEqual(new Date('2026-01-05T00:00:00Z'));
  });

  it('CRM-13: a completed activity cannot be edited except to append notes', () => {
    const activity = Activity.create(makeActivityData());
    activity.complete(new Date('2026-01-05T00:00:00Z'));
    // Notes live in the polymorphic crm_notes table — the append happens there.
    // Any edit to the activity row itself is rejected.
    expectCrmError(
      () => activity.update({ subject: 'Follow-up', updatedBy: 'user-2' }),
      CRM_ERROR_CODE.ACTIVITY_COMPLETED_IMMUTABLE,
    );
  });

  it('allows editing an activity that is not yet completed', () => {
    const activity = Activity.create(makeActivityData());
    activity.update({ subject: 'Follow-up call', dueAt: new Date('2026-02-01T00:00:00Z'), updatedBy: 'user-2' });
    expect(activity.subject).toBe('Follow-up call');
    expect(activity.dueAt).toEqual(new Date('2026-02-01T00:00:00Z'));
  });
});

describe('CRM-14: activity assignment is limited to active members', () => {
  it('accepts assignment to an active member of the organization', () => {
    const activity = Activity.create(makeActivityData());
    activity.assignTo('user-1', new Set(['user-1', 'user-2']));
    expect(activity.assignedTo).toBe('user-1');
  });

  it('rejects assignment to a user who is not an active member', () => {
    const activity = Activity.create(makeActivityData());
    expectCrmError(
      () => activity.assignTo('user-99', new Set(['user-1', 'user-2'])),
      CRM_ERROR_CODE.ACTIVITY_ASSIGNEE_NOT_ACTIVE,
    );
  });

  it('allows unassigning', () => {
    const activity = Activity.create(makeActivityData({ assignedTo: 'user-1' }));
    activity.assignTo(null, new Set(['user-1']));
    expect(activity.assignedTo).toBeNull();
  });

  it('CRM-13: a completed activity cannot be reassigned either', () => {
    const activity = Activity.create(makeActivityData());
    activity.complete(new Date('2026-01-05T00:00:00Z'));
    expectCrmError(
      () => activity.assignTo('user-2', new Set(['user-1', 'user-2'])),
      CRM_ERROR_CODE.ACTIVITY_COMPLETED_IMMUTABLE,
    );
  });
});

describe('Activity data integrity', () => {
  it('requires related_type and related_id to be a pair', () => {
    expectCrmError(
      () => Activity.create(makeActivityData({ relatedType: 'contact', relatedId: null })),
      CRM_ERROR_CODE.ACTIVITY_RELATED_PAIR,
    );
  });

  it('accepts a fully-set related pair', () => {
    const activity = Activity.create(makeActivityData({ relatedType: 'contact', relatedId: 'contact-1' }));
    expect(activity.relatedType).toBe('contact');
    expect(activity.relatedId).toBe('contact-1');
  });
});
