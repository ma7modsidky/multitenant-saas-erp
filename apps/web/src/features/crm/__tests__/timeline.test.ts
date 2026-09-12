import { describe, expect, it } from 'vitest';

import type { CrmActivity, CrmDealDetail, CrmStageHistoryEntry } from '@/lib/api/resources';

import { activityTone, buildCrmTimeline, groupTimelineByDate, type CrmTimelineEntry } from '../timeline';

const note = (id: string, createdAt: string) => ({
  id,
  body: `note ${id}`,
  relatedType: 'contact',
  relatedId: 'r1',
  createdAt,
  updatedAt: createdAt,
  createdByUserId: null,
  createdByName: null,
});

const activity = (id: string, fields: { createdAt?: string | null; dueAt?: string | null }): CrmActivity => ({
  id,
  type: 'call',
  subject: `activity ${id}`,
  dueAt: fields.dueAt ?? null,
  completedAt: null,
  relatedType: 'contact',
  relatedId: 'r1',
  assignedToUserId: null,
  ...(fields.createdAt === undefined ? {} : { createdAt: fields.createdAt }),
});

const stageChange = (id: string, movedAt: string): CrmStageHistoryEntry => ({
  id,
  fromStageId: 's1',
  toStageId: 's2',
  movedAt,
  movedBy: 'u1',
  durationSeconds: 60,
});

const deal = (id: string, createdAt: string, stageHistory: CrmStageHistoryEntry[] = []): CrmDealDetail => ({
  id,
  title: `deal ${id}`,
  pipelineId: 'p1',
  stageId: 's2',
  contactId: 'r1',
  companyId: null,
  value: { amountMinor: '1000', currency: 'USD' },
  status: 'open',
  ownerUserId: null,
  exchangeRate: null,
  baseAmountMinor: null,
  expectedCloseDate: null,
  closedAt: null,
  lostReasonCode: null,
  createdByUserId: null,
  updatedByUserId: null,
  createdAt,
  updatedAt: createdAt,
  stageHistory,
});

describe('buildCrmTimeline', () => {
  it('merges every event kind into one newest-first feed', () => {
    const timeline = buildCrmTimeline({
      createdAt: '2026-01-01T10:00:00Z',
      createdByUserId: 'u1',
      updatedAt: '2026-01-05T10:00:00Z',
      updatedByUserId: 'u2',
      notes: [note('n1', '2026-01-03T09:00:00Z')],
      activities: [activity('a1', { createdAt: '2026-01-02T09:00:00Z' })],
      deals: [deal('d1', '2026-01-04T09:00:00Z', [stageChange('h1', '2026-01-06T09:00:00Z')])],
    });

    expect(timeline.map((entry) => entry.kind)).toEqual([
      'stage-changed',
      'record-edited',
      'deal-created',
      'note',
      'activity',
      'record-created',
    ]);
    expect(timeline[5]?.at).toBe(Date.parse('2026-01-01T10:00:00Z'));
    expect(timeline[4]).toMatchObject({ kind: 'activity', id: 'a1' });
  });

  it('omits the edit event while the record has not been touched after creation', () => {
    const untouched = buildCrmTimeline({ createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T10:00:00Z' });
    expect(untouched.map((entry) => entry.kind)).toEqual(['record-created']);

    const touched = buildCrmTimeline({ createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-02T10:00:00Z' });
    expect(touched.map((entry) => entry.kind)).toEqual(['record-edited', 'record-created']);
  });

  it('places events without a usable timestamp last instead of crashing', () => {
    const timeline = buildCrmTimeline({
      notes: [note('n1', '2026-01-03T09:00:00Z'), note('n2', 'not-a-date')],
      activities: [activity('a1', { dueAt: '2026-01-02T09:00:00Z' })],
    });

    expect(timeline.map((entry) => entry.id)).toEqual(['n1', 'a1', 'n2']);
    expect(timeline[1]?.at).toBe(Date.parse('2026-01-02T09:00:00Z'));
    expect(timeline[2]?.at).toBe(0);
  });

  it('expands each deal into its creation event plus one entry per stage change', () => {
    const timeline = buildCrmTimeline({
      deals: [
        deal('d1', '2026-01-01T09:00:00Z', [
          stageChange('h1', '2026-01-02T09:00:00Z'),
          stageChange('h2', '2026-01-03T09:00:00Z'),
        ]),
      ],
    });

    expect(timeline.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      'stage-changed:h2',
      'stage-changed:h1',
      'deal-created:d1',
    ]);
  });
});

describe('activityTone', () => {
  const now = new Date('2026-08-24T15:00:00');

  it('marks completed, overdue (due before today), and scheduled activities', () => {
    expect(activityTone({ completedAt: '2026-08-20T10:00:00Z', dueAt: '2026-08-19T10:00:00Z' }, now)).toBe('completed');
    expect(activityTone({ completedAt: null, dueAt: '2026-08-23T23:59:00' }, now)).toBe('overdue');
    expect(activityTone({ completedAt: null, dueAt: '2026-08-24T09:00:00' }, now)).toBe('scheduled');
    expect(activityTone({ completedAt: null, dueAt: null }, now)).toBe('scheduled');
  });
});

describe('groupTimelineByDate', () => {
  const entry = (id: string, at: number): CrmTimelineEntry => ({
    kind: 'record-created',
    id,
    at,
    userId: null,
  });

  const startOfToday = new Date(2026, 7, 24).getTime();
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const now = new Date(2026, 7, 24, 12, 0, 0);

  it('buckets into today, yesterday, this-month, month names, and a trailing earlier group', () => {
    const groups = groupTimelineByDate(
      [
        entry('a', startOfToday + HOUR),
        entry('b', startOfToday - DAY + HOUR),
        entry('c', startOfToday - 3 * DAY),
        entry('d', startOfToday - 40 * DAY),
        entry('e', 0),
      ],
      'en',
      now,
    );

    expect(groups.map((group) => group.kind)).toEqual(['today', 'yesterday', 'this-month', 'month', 'earlier']);
    expect(groups[3]?.label).toBe(
      new Date(startOfToday - 40 * DAY).toLocaleDateString('en', { month: 'long', year: 'numeric' }),
    );
    expect(groups.map((group) => group.entries.length)).toEqual([1, 1, 1, 1, 1]);
  });

  it('merges consecutive events falling into the same bucket', () => {
    const groups = groupTimelineByDate(
      [entry('a', startOfToday + HOUR), entry('b', startOfToday + 2 * HOUR)],
      'en',
      now,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'today',
      entries: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })],
    });
  });
});
