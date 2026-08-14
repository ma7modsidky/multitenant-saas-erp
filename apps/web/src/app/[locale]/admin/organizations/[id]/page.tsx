'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, TimerOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

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
  adminDisableModule,
  adminEnableModule,
  adminExtendTrial,
  adminStopTrial,
  adminSuspendModule,
  getAdminModules,
  getAdminOrganization,
} from '@/lib/api/resources';
import { resolveEnModuleLabel } from '@/lib/module-labels';

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
};

function stateBadge(state: string, t: ReturnType<typeof useTranslations>) {
  const labelKey = `admin.orgDetail.${STATE_LABEL_KEYS[state] ?? 'stateDisabled'}`;
  const label = STATE_LABEL_KEYS[state] ? t(labelKey) : state;
  if (state === 'active' || state === 'trialing') return <Badge>{label}</Badge>;
  if (state === 'past_due') return <Badge variant="secondary">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}

type ModuleAction = 'enable-trial' | 'enable-now' | 'extend-trial' | 'stop-trial' | 'suspend' | 'activate' | 'disable';

/** Actions available for an entitlement state (PLT-8). A used trial can never
    be started again (BILL-2), so `trialUsed` hides the enable-with-trial path,
    and `trialAvailable` (catalog trialDays > 0) hides it for trial-less modules.
    Note: the state machine forbids past_due → disabled and suspended → disabled
    (validateStateTransition), so those states only offer activation. */
function actionsFor(state: string, trialUsed: boolean, trialAvailable: boolean): ModuleAction[] {
  switch (state) {
    case 'available':
      return trialUsed || !trialAvailable ? ['enable-now'] : ['enable-trial', 'enable-now'];
    case 'trialing':
      return ['extend-trial', 'stop-trial', 'disable'];
    case 'active':
      return ['suspend', 'disable'];
    case 'past_due':
      return ['activate'];
    case 'expired':
      return trialUsed || !trialAvailable ? ['extend-trial', 'disable'] : ['enable-trial', 'extend-trial', 'disable'];
    case 'suspended':
      return ['activate'];
    case 'disabled':
      return trialUsed || !trialAvailable ? ['enable-now'] : ['enable-trial', 'enable-now'];
    default:
      return ['disable'];
  }
}

const ACTION_VARIANT: Record<ModuleAction, 'default' | 'outline' | 'secondary' | 'destructive'> = {
  'enable-trial': 'outline',
  'enable-now': 'default',
  'extend-trial': 'outline',
  'stop-trial': 'secondary',
  suspend: 'secondary',
  activate: 'default',
  disable: 'outline',
};

type PendingAction =
  | { kind: 'enable-trial'; moduleKey: string; moduleName: string; skipTrial: false; days: number }
  | { kind: 'enable-now'; moduleKey: string; moduleName: string; skipTrial: true; days: 0 }
  | { kind: 'extend-trial'; moduleKey: string; moduleName: string; days: number }
  | { kind: 'stop-trial'; moduleKey: string; moduleName: string }
  | { kind: 'suspend'; moduleKey: string; moduleName: string }
  | { kind: 'activate'; moduleKey: string; moduleName: string }
  | { kind: 'disable'; moduleKey: string; moduleName: string };

/** Extend-trial dialog — preset chips + a custom day count + live end-date preview. */
function ExtendTrialDialog({
  moduleName,
  days,
  busy,
  onDaysChange,
  onConfirm,
  onCancel,
}: {
  moduleName: string;
  days: number;
  busy: boolean;
  onDaysChange: (days: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  const valid = Number.isInteger(days) && days >= 1 && days <= 365;
  const newEnd = new Date(Date.now() + days * DAY_MS);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="extend-trial-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50 cursor-default"
        onClick={onCancel}
        disabled={busy}
        aria-hidden="true"
        tabIndex={-1}
      />
      <div ref={panelRef} tabIndex={-1} className="relative w-full max-w-sm outline-none animate-fade-in">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle id="extend-trial-title" className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
              {t('admin.orgDetail.extendTrialTitle', { module: moduleName })}
            </CardTitle>
          </CardHeader>
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
          <CardFooter className="justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onCancel} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={onConfirm} loading={busy} disabled={!valid}>
              {t('common.confirm')}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
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
        case 'enable-trial':
          await adminEnableModule(org, action.moduleKey, false);
          setSuccess(t('admin.orgDetail.enableSuccess'));
          break;
        case 'enable-now':
          await adminEnableModule(org, action.moduleKey, true);
          setSuccess(t('admin.orgDetail.enableSuccess'));
          break;
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
      }
      await queryClient.invalidateQueries({ queryKey: ['admin-org', orgId] });
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
                  <dd>{stateBadge(detail.subscription.status, t)}</dd>
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
                    const trialUsed = trialStartedAt !== null;
                    const trialAvailable = (mod.trialDays ?? 0) > 0;
                    const actions = actionsFor(state, trialUsed, trialAvailable);

                    return (
                      <tr key={mod.moduleKey} className="border-b last:border-0 transition-colors hover:bg-accent/40">
                        <td className="px-4 py-3">
                          <p className="font-medium">{moduleName}</p>
                          <p className="text-xs text-muted-foreground">{mod.moduleKey}</p>
                        </td>
                        <td className="px-4 py-3">{stateBadge(state, t)}</td>
                        <td className="px-4 py-3">
                          {state === 'trialing' && trialEndsAt ? (
                            <div className="space-y-1">
                              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                                <CalendarClock className="size-3.5" aria-hidden="true" />
                                {t('admin.orgDetail.trialEnds', { date: formatDate(trialEndsAt, locale) })}
                              </p>
                              <Badge variant="secondary">
                                {t('admin.orgDetail.trialDaysLeft', { days: daysLeftUntil(trialEndsAt) })}
                              </Badge>
                            </div>
                          ) : trialUsed ? (
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
                          ) : (
                            <p className="text-xs text-muted-foreground">—</p>
                          )}
                          {state === 'disabled' && trialUsed && (
                            <p className="mt-1 max-w-56 text-xs text-muted-foreground/80">
                              {t('admin.orgDetail.trialUsedHint')}
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
                                  if (action === 'extend-trial') setExtendDays(14);
                                  if (action === 'enable-trial') {
                                    setPending({
                                      kind: 'enable-trial',
                                      moduleKey: mod.moduleKey,
                                      moduleName,
                                      skipTrial: false,
                                      days: mod.trialDays ?? 14,
                                    });
                                  } else if (action === 'enable-now') {
                                    setPending({
                                      kind: 'enable-now',
                                      moduleKey: mod.moduleKey,
                                      moduleName,
                                      skipTrial: true,
                                      days: 0,
                                    });
                                  } else if (action === 'extend-trial') {
                                    setPending({
                                      kind: 'extend-trial',
                                      moduleKey: mod.moduleKey,
                                      moduleName,
                                      days: extendDays,
                                    });
                                  } else if (action === 'stop-trial') {
                                    setPending({ kind: 'stop-trial', moduleKey: mod.moduleKey, moduleName });
                                  } else if (action === 'suspend') {
                                    setPending({ kind: 'suspend', moduleKey: mod.moduleKey, moduleName });
                                  } else if (action === 'activate') {
                                    setPending({ kind: 'activate', moduleKey: mod.moduleKey, moduleName });
                                  } else {
                                    setPending({ kind: 'disable', moduleKey: mod.moduleKey, moduleName });
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

      {pending?.kind === 'enable-trial' && (
        <ConfirmDialog
          open
          title={t('admin.orgDetail.enableConfirmTitle', { module: pending.moduleName })}
          description={t('admin.orgDetail.enableConfirmBody', { module: pending.moduleName, days: pending.days })}
          confirmLabel={t('common.confirm')}
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          loading={busy}
          onConfirm={() => void runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'enable-now' && (
        <ConfirmDialog
          open
          title={t('admin.orgDetail.enableNowConfirmTitle', { module: pending.moduleName })}
          description={t('admin.orgDetail.enableNowConfirmBody', { module: pending.moduleName })}
          confirmLabel={t('admin.orgDetail.enableNow')}
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          loading={busy}
          onConfirm={() => void runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'extend-trial' && (
        <ExtendTrialDialog
          moduleName={pending.moduleName}
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

const ACTION_LABEL_KEYS: Record<ModuleAction, string> = {
  'enable-trial': 'enableTrial',
  'enable-now': 'enableNow',
  'extend-trial': 'extendTrial',
  'stop-trial': 'stopTrial',
  suspend: 'suspend',
  activate: 'activate',
  disable: 'disable',
};
