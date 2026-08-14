import {
  Archive,
  Ban,
  CalendarClock,
  CircleCheck,
  Play,
  ShieldX,
  Sparkles,
  TimerOff,
  type LucideIcon,
} from 'lucide-react';

/**
 * Admin org-detail activity feed helpers (PLT-4). Pure functions mapping a
 * core_platform_audit_log action to the UI metadata the feed renders — kept
 * out of the page component so the mapping is unit-testable.
 */

export type ActivityTone = 'default' | 'destructive' | 'warning' | 'success' | 'muted';

export interface ActivityMeta {
  icon: LucideIcon;
  tone: ActivityTone;
  /** i18n key suffix under `admin.orgDetail.act.*` — the action description. */
  labelKey: string;
  /** True when the description takes a `{days}` param from the entry metadata. */
  hasDays: boolean;
}

const DEFAULT_ACTIVITY: ActivityMeta = {
  icon: ShieldX,
  tone: 'muted',
  labelKey: 'actDefault',
  hasDays: false,
};

const ACTIVITY_META: Record<string, ActivityMeta> = {
  'module.trial.extended': { icon: CalendarClock, tone: 'default', labelKey: 'actTrialExtended', hasDays: true },
  'module.trial.stopped': { icon: TimerOff, tone: 'warning', labelKey: 'actTrialStopped', hasDays: false },
  'module.trialing': { icon: Sparkles, tone: 'success', labelKey: 'actTrialGranted', hasDays: false },
  'module.active': { icon: CircleCheck, tone: 'success', labelKey: 'actFullAccess', hasDays: false },
  'module.blocked': { icon: ShieldX, tone: 'destructive', labelKey: 'actBlocked', hasDays: false },
  'module.suspended': { icon: Ban, tone: 'warning', labelKey: 'actSuspended', hasDays: false },
  'module.activated': { icon: Play, tone: 'success', labelKey: 'actActivated', hasDays: false },
  'module.disabled': { icon: Archive, tone: 'muted', labelKey: 'actDisabled', hasDays: false },
};

/** UI metadata for one audit action; unknown actions fall back to a generic row. */
export function activityMeta(action: string): ActivityMeta {
  return ACTIVITY_META[action] ?? DEFAULT_ACTIVITY;
}

/** `days` from the entry metadata (trial extensions) — undefined when absent. */
export function activityDays(metadata: Record<string, unknown> | null): number | undefined {
  const days = metadata?.days;
  return typeof days === 'number' && Number.isFinite(days) ? days : undefined;
}

/** `moduleKey` from the entry metadata — null when absent. */
export function activityModuleKey(metadata: Record<string, unknown> | null): string | null {
  const key = metadata?.moduleKey;
  return typeof key === 'string' ? key : null;
}
