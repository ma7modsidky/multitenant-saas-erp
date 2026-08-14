'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowLeft, CalendarClock, CreditCard, Gift, ShieldX, TimerOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import {
  adminActivateModule,
  adminBlockModule,
  adminDisableModule,
  adminEnableModule,
  adminExtendTrial,
  adminStopTrial,
  adminSuspendModule,
  getAdminModules,
  getAdminOrganization,
  getAdminOrganizationActivity,
} from '@/lib/api/resources';
import { activityDays, activityMeta, activityModuleKey, type ActivityTone } from '@/lib/admin-activity';
import { resolveEnModuleLabel } from '@/lib/module-labels';
import {
  actionsFor,
  enableModesFor,
  extendedTrialEnd,
  type EnableMode,
  type ModuleAction,
} from '@/lib/admin-entitlements';

const DAY_MS = 24 * 60 * 60 * 1000;
const EXTEND_PRESETS = [7, 14, 30];

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

function daysLeftUntil(iso: string | null): number {
  if (!iso) return 0;
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
}

const STATE_LABEL_KEYS: Record<string, string> = {
  available: 'stateAvailable',
  trialing: 'stateTrial',
  active: 'stateActive',
  past_due: 'statePastDue',
  expired: 'stateExpired',
  suspended: 'stateSuspended',
  disabled: 'stateDisabled',
  blocked: 'stateBlocked',
};

function stateBadge(state: string, t: ReturnType<typeof useTranslations>) {
  const labelKey = `admin.orgDetail.${STATE_LABEL_KEYS[state] ?? 'stateDisabled'}`;
  const label = STATE_LABEL_KEYS[state] ? t(labelKey) : state;
  if (state === 'active' || state === 'trialing') return <Badge>{label}</Badge>;
  if (state === 'past_due' || state === 'suspended' || state === 'blocked') {
    // Blocked matches the tenant-facing ModuleStateBadge treatment (destructive)
    // so the same state reads identically in both consoles.
    return <Badge variant={state === 'blocked' ? 'destructive' : 'secondary'}>{label}</Badge>;
  }
  return <Badge variant="outline">{label}</Badge>;
}

/** Stripe subscription statuses → localized badge (the subscription card uses
    these, NOT the entitlement state labels — canceled/unpaid/incomplete would
    otherwise fall through to "Disabled"). */
const SUB_STATUS_LABEL_KEYS: Record<string, string> = {
  active: 'subStatusActive',
  trialing: 'subStatusTrialing',
  past_due: 'subStatusPastDue',
  canceled: 'subStatusCanceled',
  unpaid: 'subStatusUnpaid',
  incomplete: 'subStatusIncomplete',
  incomplete_expired: 'subStatusIncompleteExpired',
};

function subscriptionStatusBadge(status: string, t: ReturnType<typeof useTranslations>) {
  const labelKey = SUB_STATUS_LABEL_KEYS[status];
  const label = labelKey ? t(`admin.orgDetail.${labelKey}`) : status;
  if (status === 'active' || status === 'trialing') return <Badge>{label}</Badge>;
  if (status === 'past_due' || status === 'unpaid' || status === 'incomplete') {
    return <Badge variant="secondary">{label}</Badge>;
  }
  return <Badge variant="outline">{label}</Badge>;
}

const ACTION_VARIANT: Record<ModuleAction, 'default' | 'outline' | 'secondary' | 'destructive'> = {
  enable: 'default',
  'extend-trial': 'outline',
  'stop-trial': 'secondary',
  suspend: 'secondary',
  activate: 'default',
  disable: 'outline',
  block: 'outline',
};

const ACTION_LABEL_KEYS: Record<ModuleAction, string> = {
  enable: 'enable',
  'extend-trial': 'extendTrial',
  'stop-trial': 'stopTrial',
  suspend: 'suspend',
  activate: 'activate',
  disable: 'disable',
  block: 'block',
};

type PendingAction =
  | {
      kind: 'enable';
      moduleKey: string;
      moduleName: string;
      modes: EnableMode[];
      trialAvailable: boolean;
      defaultTrialDays: number;
      /** Chosen inside the dialog — appended before runAction. */
      mode?: EnableMode;
      days?: number;
      /** ISO end date of a bounded free grant (full mode); absent = unlimited. */
      accessUntil?: string;
    }
  | {
      kind: 'extend-trial';
      moduleKey: string;
      moduleName: string;
      days: number;
      currentEnd: string | null;
      /** Entitlement state — the preview mirrors the backend (expired ⇒ from now). */
      state: string;
    }
  | { kind: 'stop-trial'; moduleKey: string; moduleName: string }
  | { kind: 'suspend'; moduleKey: string; moduleName: string; paid: boolean }
  | { kind: 'activate'; moduleKey: string; moduleName: string }
  | { kind: 'disable'; moduleKey: string; moduleName: string }
  | { kind: 'block'; moduleKey: string; moduleName: string };

/** Shared dialog chrome — backdrop, focus trap-lite, Escape handling. */
function DialogShell({
  title,
  children,
  footer,
  onCancel,
}: {
  title: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 cursor-default"
        onClick={onCancel}
        aria-hidden="true"
        tabIndex={-1}
      />
      <div ref={panelRef} tabIndex={-1} className="relative w-full max-w-sm outline-none animate-fade-in">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">{title}</CardTitle>
          </CardHeader>
          {children}
          <CardFooter className="justify-end gap-2 border-t pt-3">{footer}</CardFooter>
        </Card>
      </div>
    </div>
  );
}

/** Enable dialog — the single entry point for granting access. Three modes:
    grant a trial (admin picks the day count), grant full access, or block
    until paid (PLT-8). Trial mode is hidden when the org already used its
    trial (BILL-2); block mode is hidden when already blocked. A full-access
    grant is FREE (no billing) and can be unlimited or bounded by an end date
    (PLT-8/BILL-14). */
function EnableDialog({
  moduleName,
  modes,
  defaultTrialDays,
  trialAvailable,
  busy,
  onConfirm,
  onCancel,
}: {
  moduleName: string;
  modes: EnableMode[];
  defaultTrialDays: number;
  trialAvailable: boolean;
  busy: boolean;
  onConfirm: (mode: EnableMode, days: number, accessUntil?: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [mode, setMode] = useState<EnableMode>(modes[0] ?? 'full');
  const [days, setDays] = useState(Math.max(1, defaultTrialDays));
  // Free-grant period: unlimited by default, or bounded by an explicit date.
  const [period, setPeriod] = useState<'unlimited' | 'until'>('unlimited');
  const [untilDate, setUntilDate] = useState('');

  const validDays = Number.isInteger(days) && days >= 1 && days <= 365;
  const validUntil = untilDate.length > 0 && new Date(`${untilDate}T00:00:00`).getTime() > Date.now();
  const trialEnd =
    mode === 'trial' && validDays ? formatDate(new Date(Date.now() + days * DAY_MS).toISOString(), locale) : null;

  return (
    <DialogShell
      title={t('admin.orgDetail.enableDialogTitle', { module: moduleName })}
      onCancel={onCancel}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() =>
              onConfirm(
                mode,
                days,
                mode === 'full' && period === 'until' && validUntil
                  ? new Date(`${untilDate}T00:00:00`).toISOString()
                  : undefined,
              )
            }
            loading={busy}
            disabled={(mode === 'trial' && !validDays) || (mode === 'full' && period === 'until' && !validUntil)}
          >
            {mode === 'block' ? t('admin.orgDetail.block') : t('common.confirm')}
          </Button>
        </>
      }
    >
      <CardContent className="space-y-3 pt-0">
        <div role="radiogroup" aria-label={t('admin.orgDetail.enableModeLabel')} className="space-y-2">
          {modes.includes('trial') && trialAvailable && (
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                mode === 'trial' ? 'border-primary bg-primary/5' : 'hover:bg-accent/40'
              }`}
            >
              <input
                type="radio"
                name="enable-mode"
                className="mt-1 size-4 accent-(--primary)"
                checked={mode === 'trial'}
                onChange={() => setMode('trial')}
              />
              <span className="flex-1">
                <span className="block text-sm font-medium">{t('admin.orgDetail.enableTrialLabel')}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t('admin.orgDetail.enableTrialHint')}
                </span>
              </span>
            </label>
          )}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
              mode === 'full' ? 'border-primary bg-primary/5' : 'hover:bg-accent/40'
            }`}
          >
            <input
              type="radio"
              name="enable-mode"
              className="mt-1 size-4 accent-(--primary)"
              checked={mode === 'full'}
              onChange={() => setMode('full')}
            />
            <span className="flex-1">
              <span className="block text-sm font-medium">{t('admin.orgDetail.enableFullLabel')}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t('admin.orgDetail.enableFullHint')}</span>
            </span>
          </label>
          {modes.includes('block') && (
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                mode === 'block' ? 'border-primary bg-primary/5' : 'hover:bg-accent/40'
              }`}
            >
              <input
                type="radio"
                name="enable-mode"
                className="mt-1 size-4 accent-(--primary)"
                checked={mode === 'block'}
                onChange={() => setMode('block')}
              />
              <span className="flex-1">
                <span className="block text-sm font-medium">{t('admin.orgDetail.enableBlockLabel')}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t('admin.orgDetail.enableBlockHint')}
                </span>
              </span>
            </label>
          )}
        </div>

        {mode === 'trial' && (
          <div className="space-y-3 rounded-md border border-dashed p-3">
            <div className="flex flex-wrap gap-2">
              {EXTEND_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant={days === preset ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDays(preset)}
                >
                  {preset} {t('admin.orgDetail.daysShort')}
                </Button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enable-trial-days">{t('admin.orgDetail.enableTrialDaysLabel')}</Label>
              <Input
                id="enable-trial-days"
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                {...(validDays ? {} : { error: t('admin.orgDetail.extendTrialInvalid') })}
              />
            </div>
            <div className="rounded-md bg-muted/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t('admin.orgDetail.enableTrialEnds')}: </span>
              <span className="font-medium tabular-nums">{trialEnd ?? '—'}</span>
            </div>
          </div>
        )}

        {mode === 'full' && (
          <div className="space-y-3 rounded-md border border-dashed p-3">
            <p className="text-xs font-medium text-muted-foreground">{t('admin.orgDetail.grantPeriodLabel')}</p>
            <div role="radiogroup" aria-label={t('admin.orgDetail.grantPeriodLabel')} className="space-y-2">
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                  period === 'unlimited' ? 'border-primary bg-primary/5' : 'hover:bg-accent/40'
                }`}
              >
                <input
                  type="radio"
                  name="grant-period"
                  className="mt-0.5 size-4 accent-(--primary)"
                  checked={period === 'unlimited'}
                  onChange={() => setPeriod('unlimited')}
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{t('admin.orgDetail.grantUnlimitedOption')}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t('admin.orgDetail.grantUnlimitedHint')}
                  </span>
                </span>
              </label>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors ${
                  period === 'until' ? 'border-primary bg-primary/5' : 'hover:bg-accent/40'
                }`}
              >
                <input
                  type="radio"
                  name="grant-period"
                  className="mt-0.5 size-4 accent-(--primary)"
                  checked={period === 'until'}
                  onChange={() => setPeriod('until')}
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{t('admin.orgDetail.grantUntilOption')}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t('admin.orgDetail.grantUntilHint')}
                  </span>
                </span>
              </label>
            </div>
            {period === 'until' && (
              <div className="space-y-1.5">
                <Label htmlFor="grant-until-date">{t('admin.orgDetail.grantUntilDateLabel')}</Label>
                <Input
                  id="grant-until-date"
                  type="date"
                  value={untilDate}
                  onChange={(e) => setUntilDate(e.target.value)}
                  // Only flag an invalid date once the admin picked one.
                  {...(untilDate.length === 0 || validUntil ? {} : { error: t('admin.orgDetail.grantUntilInvalid') })}
                />
              </div>
            )}
          </div>
        )}

        {mode === 'block' && (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            {t('admin.orgDetail.enableBlockNotice')}
          </p>
        )}
      </CardContent>
    </DialogShell>
  );
}

/** Extend-trial dialog — preset chips + custom day count + live end-date
    preview that mirrors the backend rule: days are added to the current end
    while the trial is running, but from NOW once it ended (lapsed/stopped) —
    so "extend 1 day" never shows a confusing date, and a stopped trial never
    previews the stale remainder + days. */
function ExtendTrialDialog({
  moduleName,
  state,
  currentEnd,
  days,
  busy,
  onDaysChange,
  onConfirm,
  onCancel,
}: {
  moduleName: string;
  state: string;
  currentEnd: string | null;
  days: number;
  busy: boolean;
  onDaysChange: (days: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const valid = Number.isInteger(days) && days >= 1 && days <= 365;
  const newEnd = extendedTrialEnd(state, currentEnd, days);

  return (
    <DialogShell
      title={
        <span className="flex items-center gap-2">
          <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('admin.orgDetail.extendTrialTitle', { module: moduleName })}
        </span>
      }
      onCancel={onCancel}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onConfirm} loading={busy} disabled={!valid}>
            {t('common.confirm')}
          </Button>
        </>
      }
    >
      <CardContent className="space-y-4 pt-0">
        <div className="flex flex-wrap gap-2">
          {EXTEND_PRESETS.map((preset) => (
            <Button
              key={preset}
              type="button"
              variant={days === preset ? 'default' : 'outline'}
              size="sm"
              onClick={() => onDaysChange(preset)}
            >
              +{preset} {t('admin.orgDetail.daysShort')}
            </Button>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="extend-trial-days">{t('admin.orgDetail.extendTrialDaysLabel')}</Label>
          <Input
            id="extend-trial-days"
            type="number"
            min={1}
            max={365}
            inputMode="numeric"
            value={days}
            onChange={(e) => onDaysChange(Number(e.target.value))}
            {...(valid ? {} : { error: t('admin.orgDetail.extendTrialInvalid') })}
          />
        </div>
        <div className="rounded-md bg-muted/60 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t('admin.orgDetail.extendTrialNewEnd')}: </span>
          <span className="font-medium tabular-nums">{valid ? formatDate(newEnd.toISOString(), locale) : '—'}</span>
        </div>
      </CardContent>
    </DialogShell>
  );
}

/** Compact relative timestamp ("2h ago") — falls back to a date past ~7 days. */
function formatRelative(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = date.getTime() - Date.now();
  const absMin = Math.abs(diffMs) / 60000;
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (absMin < 1) return fmt.format(Math.round(diffMs / 1000), 'second');
  if (absMin < 60) return fmt.format(Math.round(diffMs / 60000), 'minute');
  if (absMin < 1440) return fmt.format(Math.round(diffMs / 3600000), 'hour');
  if (absMin < 10080) return fmt.format(Math.round(diffMs / 86400000), 'day');
  return formatDate(iso, locale);
}

/** Icon-tile background per activity tone (matches the state badge palette). */
const ACTIVITY_TONE_CLASS: Record<ActivityTone, string> = {
  default: 'bg-primary/10 text-primary',
  destructive: 'bg-destructive/10 text-destructive',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  muted: 'bg-muted text-muted-foreground',
};

/**
 * Recent-activity feed (PLT-4) — the platform-admin actions recorded against
 * this org (trial extend/stop, block, suspend, activate, enable, disable).
 * The feed is a separate query so an action invalidates it alongside the
 * org detail without refetching the whole page.
 */
function ActivityFeed({ orgId, modules }: { orgId: string; modules: Array<{ moduleKey: string; name: string }> }) {
  const t = useTranslations();
  const locale = useLocale();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-org-activity', orgId],
    queryFn: () => getAdminOrganizationActivity(orgId),
    enabled: Boolean(orgId),
  });

  const items = data?.items ?? [];
  const nameByKey = new Map(modules.map((m) => [m.moduleKey, resolveEnModuleLabel(m.name)]));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('admin.orgDetail.activityTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin.orgDetail.activityEmpty')}</p>
        ) : (
          <ul className="divide-y">
            {items.map((entry) => {
              const meta = activityMeta(entry.action);
              const Icon = meta.icon;
              const moduleKey = activityModuleKey(entry.metadata);
              const moduleName = moduleKey ? (nameByKey.get(moduleKey) ?? moduleKey) : null;
              const days = meta.hasDays ? (activityDays(entry.metadata) ?? 0) : undefined;
              const beforeStateRaw = entry.before?.state;
              const afterStateRaw = entry.after?.state;
              const beforeState = typeof beforeStateRaw === 'string' ? beforeStateRaw : null;
              const afterState = typeof afterStateRaw === 'string' ? afterStateRaw : null;
              const stateChange =
                beforeState && afterState && beforeState !== afterState
                  ? `${t(`admin.orgDetail.${STATE_LABEL_KEYS[beforeState] ?? 'stateDisabled'}`)} → ${t(
                      `admin.orgDetail.${STATE_LABEL_KEYS[afterState] ?? 'stateDisabled'}`,
                    )}`
                  : null;

              return (
                <li key={entry.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <span
                    className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${ACTIVITY_TONE_CLASS[meta.tone]}`}
                    aria-hidden="true"
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-medium">
                        {t(`admin.orgDetail.${meta.labelKey}`, { ...(days !== undefined ? { days } : {}) })}
                      </span>
                      {moduleName && <Badge variant="outline">{moduleName}</Badge>}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {stateChange ? `${stateChange} · ` : ''}
                      {entry.actorEmail
                        ? t.rich('admin.orgDetail.activityBy', {
                            email: entry.actorEmail,
                            // Keep the LTR email readable inside an RTL sentence.
                            mail: (chunks) => (
                              <span dir="ltr" className="font-medium">
                                {chunks}
                              </span>
                            ),
                          })
                        : '—'}
                      {' · '}
                      <time dateTime={entry.occurredAt} title={formatDate(entry.occurredAt, locale)}>
                        {formatRelative(entry.occurredAt, locale)}
                      </time>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminOrganizationDetailPage() {
  const t = useTranslations();
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const orgId = params.id;
  const queryClient = useQueryClient();

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [extendDays, setExtendDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['admin-org', orgId],
    queryFn: () => getAdminOrganization(orgId),
    enabled: Boolean(orgId),
  });
  const { data: modules } = useQuery({ queryKey: ['admin-modules'], queryFn: getAdminModules });

  const runAction = async (action: PendingAction) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    const org = orgId;
    try {
      switch (action.kind) {
        case 'enable': {
          const { mode, days, accessUntil } = action;
          if (mode === 'block') {
            await adminBlockModule(org, action.moduleKey);
            setSuccess(t('admin.orgDetail.blockSuccess'));
          } else if (mode === 'full') {
            // PLT-8: free grant — unlimited, or bounded by an explicit date.
            await adminEnableModule(org, action.moduleKey, {
              skipTrial: true,
              ...(accessUntil !== undefined ? { accessUntil } : {}),
            });
            setSuccess(t('admin.orgDetail.enableSuccess'));
          } else {
            // exactOptionalPropertyTypes: only attach trialDays when present.
            await adminEnableModule(org, action.moduleKey, {
              skipTrial: false,
              ...(days !== undefined ? { trialDays: days } : {}),
            });
            setSuccess(t('admin.orgDetail.enableSuccess'));
          }
          break;
        }
        case 'extend-trial':
          await adminExtendTrial(org, action.moduleKey, action.days);
          setSuccess(t('admin.orgDetail.extendSuccess'));
          break;
        case 'stop-trial':
          await adminStopTrial(org, action.moduleKey);
          setSuccess(t('admin.orgDetail.stopSuccess'));
          break;
        case 'suspend':
          await adminSuspendModule(org, action.moduleKey);
          setSuccess(t('admin.orgDetail.suspendSuccess'));
          break;
        case 'activate':
          await adminActivateModule(org, action.moduleKey);
          setSuccess(t('admin.orgDetail.activateSuccess'));
          break;
        case 'disable':
          await adminDisableModule(org, action.moduleKey);
          setSuccess(t('admin.orgDetail.disableSuccess'));
          break;
        case 'block':
          await adminBlockModule(org, action.moduleKey);
          setSuccess(t('admin.orgDetail.blockSuccess'));
          break;
      }
      await queryClient.invalidateQueries({ queryKey: ['admin-org', orgId] });
      // PLT-4: an admin action is itself an activity entry — refresh the feed.
      await queryClient.invalidateQueries({ queryKey: ['admin-org-activity', orgId] });
      setPending(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'NETWORK_ERROR'
          ? t('auth.errors.network')
          : t('admin.orgDetail.actionFailed'),
      );
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !detail) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const entitlements = detail.entitlements;
  const periodEnd = detail.subscription?.currentPeriodEnd ?? null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ms-2">
          <Link href={`/admin/organizations`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t('admin.orgDetail.back')}
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{detail.organization.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {detail.organization.slug} · {t('admin.organizations.tableCreated')}{' '}
          {formatDate(detail.organization.createdAt, locale)}
        </p>
      </div>

      {(error || success) && (
        <p
          role="status"
          className={
            error
              ? 'rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive'
              : 'rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400'
          }
        >
          {error ?? success}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Members */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('admin.orgDetail.membersTitle')}</CardTitle>
            <CardDescription>
              {detail.members.length} · {t('admin.organizations.tableMembers')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('admin.orgDetail.noMembers')}</p>
            ) : (
              <ul className="space-y-3">
                {detail.members.map((member) => (
                  <li key={member.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{member.name}</p>
                      <p className="truncate text-xs text-muted-foreground" dir="ltr" style={{ textAlign: 'start' }}>
                        {member.email}
                      </p>
                    </div>
                    <Badge variant="secondary">{member.roleId}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Subscription */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('admin.orgDetail.subscriptionTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.subscription === null ? (
              <p className="text-sm text-muted-foreground">{t('admin.orgDetail.noSubscription')}</p>
            ) : (
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">{t('admin.orgDetail.status')}</dt>
                  <dd>{subscriptionStatusBadge(detail.subscription.status, t)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">{t('admin.orgDetail.currency')}</dt>
                  <dd className="font-medium">{detail.subscription.billingCurrency}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">{t('admin.orgDetail.periodEnd')}</dt>
                  <dd className="tabular-nums">{formatDate(detail.subscription.currentPeriodEnd, locale)}</dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Entitlements */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('admin.orgDetail.entitlementsTitle')}</CardTitle>
          <CardDescription>{t('admin.orgDetail.entitlementsHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {(modules ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin.orgDetail.noEntitlements')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('admin.pricing.tableModule')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('admin.orgDetail.status')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('admin.orgDetail.trialColumn')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(modules ?? []).map((mod) => {
                    const moduleName = resolveEnModuleLabel(mod.name);
                    const ent = entitlements.find((e) => e.moduleKey === mod.moduleKey);
                    const state = ent?.state ?? 'available';
                    const trialStartedAt = ent?.trialStartedAt ?? null;
                    const trialEndsAt = ent?.trialEndsAt ?? null;
                    const accessUntil = ent?.accessUntil ?? null;
                    const trialUsed = trialStartedAt !== null;
                    const trialAvailable = (mod.trialDays ?? 0) > 0;
                    const isPaid = ent?.isPaid ?? false;
                    const actions = actionsFor(state, trialUsed, trialAvailable, isPaid);
                    const modes = enableModesFor(state, trialUsed);

                    return (
                      <tr key={mod.moduleKey} className="border-b last:border-0 transition-colors hover:bg-accent/40">
                        <td className="px-4 py-3">
                          <p className="font-medium">{moduleName}</p>
                          <p className="text-xs text-muted-foreground">{mod.moduleKey}</p>
                        </td>
                        <td className="px-4 py-3">{stateBadge(state, t)}</td>
                        <td className="px-4 py-3">
                          {/* Paid badge — the org pays for this module (PLT-8) */}
                          {isPaid && (
                            <div className="space-y-1">
                              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                <CreditCard className="size-3.5" aria-hidden="true" />
                                <Badge variant="secondary">{t('admin.orgDetail.paidBadge')}</Badge>
                                {/* isPaid implies a Stripe item; the renewal
                                    date may still be null on a fresh sub. */}
                                {periodEnd && (
                                  <span className="tabular-nums">
                                    {t('admin.orgDetail.renewsOn', { date: formatDate(periodEnd, locale) })}
                                  </span>
                                )}
                              </p>
                            </div>
                          )}
                          {/* Free grant — unlimited, or bounded by an end date (PLT-8/BILL-14) */}
                          {!isPaid && state === 'active' && (
                            <div className="space-y-1">
                              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Gift className="size-3.5" aria-hidden="true" />
                                <Badge variant="outline">{t('admin.orgDetail.grantedBadge')}</Badge>
                                {accessUntil ? (
                                  <span className="tabular-nums">
                                    {t('admin.orgDetail.grantAccessUntil', {
                                      date: formatDate(accessUntil, locale),
                                    })}
                                  </span>
                                ) : (
                                  <span>{t('admin.orgDetail.grantUnlimitedAccess')}</span>
                                )}
                              </p>
                            </div>
                          )}
                          {state === 'trialing' && trialEndsAt && (
                            <div className="space-y-1">
                              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                <CalendarClock className="size-3.5" aria-hidden="true" />
                                {t('admin.orgDetail.trialEnds', { date: formatDate(trialEndsAt, locale) })}
                              </p>
                              <Badge variant="secondary">
                                {t('admin.orgDetail.trialDaysLeft', { days: daysLeftUntil(trialEndsAt) })}
                              </Badge>
                            </div>
                          )}
                          {!isPaid && trialUsed && state !== 'trialing' && (
                            <div className="space-y-1">
                              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                <TimerOff className="size-3.5" aria-hidden="true" />
                                {t('admin.orgDetail.trialUsed')}
                              </p>
                              {state === 'expired' && trialEndsAt && (
                                <p className="text-xs text-muted-foreground">
                                  {t('admin.orgDetail.trialEndedAt', { date: formatDate(trialEndsAt, locale) })}
                                </p>
                              )}
                            </div>
                          )}
                          {state === 'blocked' && (
                            <p className="flex items-center gap-1 text-xs text-muted-foreground">
                              <ShieldX className="size-3.5" aria-hidden="true" />
                              {t('admin.orgDetail.blockedHint')}
                            </p>
                          )}
                          {/* A lapsed time-boxed grant sits in expired (read-only grace) */}
                          {!isPaid && state === 'expired' && accessUntil && (
                            <p className="text-xs text-muted-foreground">
                              {t('admin.orgDetail.grantEndedAt', { date: formatDate(accessUntil, locale) })}
                            </p>
                          )}
                          {!isPaid && state === 'available' && trialAvailable && !trialUsed && (
                            <p className="text-xs text-muted-foreground">
                              {t('admin.orgDetail.notStartedHint', { days: mod.trialDays })}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {actions.map((action) => (
                              <Button
                                key={action}
                                variant={ACTION_VARIANT[action]}
                                size="sm"
                                onClick={() => {
                                  if (action === 'enable') {
                                    setPending({
                                      kind: 'enable',
                                      moduleKey: mod.moduleKey,
                                      moduleName,
                                      modes,
                                      trialAvailable,
                                      defaultTrialDays: mod.trialDays ?? 14,
                                    });
                                  } else if (action === 'extend-trial') {
                                    setExtendDays(14);
                                    setPending({
                                      kind: 'extend-trial',
                                      moduleKey: mod.moduleKey,
                                      moduleName,
                                      days: extendDays,
                                      currentEnd: trialEndsAt,
                                      state,
                                    });
                                  } else if (action === 'stop-trial') {
                                    setPending({ kind: 'stop-trial', moduleKey: mod.moduleKey, moduleName });
                                  } else if (action === 'suspend') {
                                    setPending({ kind: 'suspend', moduleKey: mod.moduleKey, moduleName, paid: isPaid });
                                  } else if (action === 'activate') {
                                    setPending({ kind: 'activate', moduleKey: mod.moduleKey, moduleName });
                                  } else if (action === 'disable') {
                                    setPending({ kind: 'disable', moduleKey: mod.moduleKey, moduleName });
                                  } else {
                                    setPending({ kind: 'block', moduleKey: mod.moduleKey, moduleName });
                                  }
                                }}
                              >
                                {t(`admin.orgDetail.${ACTION_LABEL_KEYS[action]}`)}
                              </Button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent platform-admin activity (PLT-4) */}
      <ActivityFeed orgId={orgId} modules={modules ?? []} />

      {/* ─── Dialogs ─────────────────────────────────────────────────────── */}

      {pending?.kind === 'disable' && (
        <ConfirmDialog
          open
          destructive
          title={t('admin.orgDetail.disableConfirmTitle', { module: pending.moduleName })}
          description={t('admin.orgDetail.disableConfirmBody', { module: pending.moduleName })}
          confirmLabel={t('admin.orgDetail.disable')}
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          loading={busy}
          onConfirm={() => void runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'block' && (
        <ConfirmDialog
          open
          destructive
          title={t('admin.orgDetail.blockConfirmTitle', { module: pending.moduleName })}
          description={t('admin.orgDetail.blockConfirmBody', { module: pending.moduleName })}
          confirmLabel={t('admin.orgDetail.block')}
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          loading={busy}
          onConfirm={() => void runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'enable' && (
        <EnableDialog
          moduleName={pending.moduleName}
          modes={pending.modes}
          defaultTrialDays={pending.defaultTrialDays}
          trialAvailable={pending.trialAvailable}
          busy={busy}
          onConfirm={(mode, days, accessUntil) =>
            void runAction({ ...pending, mode, days, ...(accessUntil !== undefined ? { accessUntil } : {}) })
          }
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'extend-trial' && (
        <ExtendTrialDialog
          moduleName={pending.moduleName}
          state={pending.state}
          currentEnd={pending.currentEnd}
          days={extendDays}
          busy={busy}
          onDaysChange={setExtendDays}
          onConfirm={() => void runAction({ ...pending, days: extendDays })}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'stop-trial' && (
        <ConfirmDialog
          open
          title={t('admin.orgDetail.stopTrialTitle', { module: pending.moduleName })}
          description={t('admin.orgDetail.stopTrialBody', { module: pending.moduleName })}
          confirmLabel={t('admin.orgDetail.stopTrial')}
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          loading={busy}
          onConfirm={() => void runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'suspend' && (
        <ConfirmDialog
          open
          title={t('admin.orgDetail.suspendTitle', { module: pending.moduleName })}
          description={t('admin.orgDetail.suspendBody', { module: pending.moduleName })}
          confirmLabel={t('admin.orgDetail.suspend')}
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          loading={busy}
          onConfirm={() => void runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'activate' && (
        <ConfirmDialog
          open
          title={t('admin.orgDetail.activateTitle', { module: pending.moduleName })}
          description={t('admin.orgDetail.activateBody', { module: pending.moduleName })}
          confirmLabel={t('admin.orgDetail.activate')}
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          loading={busy}
          onConfirm={() => void runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
