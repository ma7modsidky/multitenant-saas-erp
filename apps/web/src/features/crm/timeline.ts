import type { CrmActivity, CrmDealDetail, CrmNote, CrmStageHistoryEntry } from '@/lib/api/resources';

export const TIMELINE_DEAL_LIMIT = 20;

/** Events rendered before the "Load more activities" control appears. */
export const TIMELINE_PAGE_SIZE = 15;

export type CrmTimelineEntry =
  | { kind: 'note'; id: string; at: number; note: CrmNote }
  | { kind: 'activity'; id: string; at: number; activity: CrmActivity }
  | { kind: 'deal-created'; id: string; at: number; deal: CrmDealDetail }
  | { kind: 'stage-changed'; id: string; at: number; entry: CrmStageHistoryEntry; deal: CrmDealDetail }
  | { kind: 'record-created'; id: string; at: number; userId: string | null }
  | { kind: 'record-edited'; id: string; at: number; userId: string | null };

export interface CrmTimelineInput {
  createdAt?: string | null;
  createdByUserId?: string | null;
  updatedAt?: string | null;
  updatedByUserId?: string | null;
  notes?: CrmNote[];
  activities?: CrmActivity[];
  deals?: CrmDealDetail[];
  /**
   * When false, a deal in `deals` produces only its stage-change events — used
   * by the deal's own detail page, where a separate "created" event would
   * duplicate the record-created entry for the same record.
   */
  showDealCreated?: boolean;
}

function epoch(iso: string | null | undefined): number {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}

export function buildCrmTimeline(input: CrmTimelineInput): CrmTimelineEntry[] {
  const recordEvents: CrmTimelineEntry[] = [];
  if (input.createdAt)
    recordEvents.push({
      kind: 'record-created',
      id: 'record-created',
      at: epoch(input.createdAt),
      userId: input.createdByUserId ?? null,
    });
  if (input.updatedAt && input.updatedAt !== input.createdAt)
    recordEvents.push({
      kind: 'record-edited',
      id: 'record-edited',
      at: epoch(input.updatedAt),
      userId: input.updatedByUserId ?? null,
    });

  const noteEvents = (input.notes ?? []).map<CrmTimelineEntry>((note) => ({
    kind: 'note',
    id: note.id,
    at: epoch(note.createdAt),
    note,
  }));
  const activityEvents = (input.activities ?? []).map<CrmTimelineEntry>((activity) => ({
    kind: 'activity',
    id: activity.id,
    at: epoch(activity.createdAt ?? activity.dueAt),
    activity,
  }));
  const dealEvents = (input.deals ?? []).flatMap<CrmTimelineEntry>((deal) => {
    const events: CrmTimelineEntry[] = [];
    if (input.showDealCreated !== false)
      events.push({ kind: 'deal-created', id: deal.id, at: epoch(deal.createdAt), deal });
    for (const entry of deal.stageHistory)
      events.push({ kind: 'stage-changed', id: entry.id, at: epoch(entry.movedAt), entry, deal });
    return events;
  });

  return [...recordEvents, ...noteEvents, ...activityEvents, ...dealEvents].sort((a, b) => b.at - a.at);
}

// ─── Timeline presentation helpers ──────────────────────────────────────────

export type CrmActivityTone = 'completed' | 'overdue' | 'scheduled';

/** Calendar-day tone for an activity, matching DueBadge's local-day math. */
export function activityTone(
  activity: Pick<CrmActivity, 'completedAt' | 'dueAt'>,
  now: Date = new Date(),
): CrmActivityTone {
  if (activity.completedAt) return 'completed';
  if (!activity.dueAt) return 'scheduled';
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (Date.parse(activity.dueAt) < startOfDay(now)) return 'overdue';
  return 'scheduled';
}

export type CrmTimelineGroupKind = 'today' | 'yesterday' | 'this-month' | 'month' | 'earlier';

export interface CrmTimelineGroup {
  key: string;
  kind: CrmTimelineGroupKind;
  /** Localized month-year label — only set for `kind: 'month'` groups. */
  label: string;
  entries: CrmTimelineEntry[];
}

/**
 * Bucket a (newest-first) timeline into display groups: Today, Yesterday,
 * Earlier this month, then one group per older calendar month. Events without
 * a usable timestamp land in a trailing "Earlier" bucket.
 */
export function groupTimelineByDate(
  entries: CrmTimelineEntry[],
  locale: string,
  now: Date = new Date(),
): CrmTimelineGroup[] {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - 86_400_000;
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const currentMonth = monthKey(now);

  const groups: CrmTimelineGroup[] = [];
  const append = (group: CrmTimelineGroup, entry: CrmTimelineEntry) => {
    const existing = groups.find((candidate) => candidate.key === group.key);
    if (existing) existing.entries.push(entry);
    else groups.push({ ...group, entries: [entry] });
  };

  for (const entry of entries) {
    const ts = entry.at;
    if (ts <= 0) {
      append({ key: 'earlier', kind: 'earlier', label: '', entries: [] }, entry);
    } else if (ts >= todayStart) {
      append({ key: 'today', kind: 'today', label: '', entries: [] }, entry);
    } else if (ts >= yesterdayStart) {
      append({ key: 'yesterday', kind: 'yesterday', label: '', entries: [] }, entry);
    } else {
      const date = new Date(ts);
      const key = monthKey(date);
      if (key === currentMonth) {
        append({ key: 'this-month', kind: 'this-month', label: '', entries: [] }, entry);
      } else {
        append(
          {
            key: `month:${key}`,
            kind: 'month',
            label: date.toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
            entries: [],
          },
          entry,
        );
      }
    }
  }
  return groups;
}
