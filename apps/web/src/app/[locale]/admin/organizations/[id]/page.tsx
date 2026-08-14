'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { adminDisableModule, adminEnableModule, getAdminModules, getAdminOrganization } from '@/lib/api/resources';

const ENABLED_STATES = new Set(['active', 'trialing', 'past_due']);

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
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

type PendingAction =
  | { kind: 'enable'; moduleKey: string; moduleName: string; skipTrial: boolean; days: number }
  | { kind: 'disable'; moduleKey: string; moduleName: string };

export default function AdminOrganizationDetailPage() {
  const t = useTranslations();
  const locale = useLocale();
  const params = useParams<{ id: string }>();
  const orgId = params.id;
  const queryClient = useQueryClient();

  const [pending, setPending] = useState<PendingAction | null>(null);
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
    try {
      if (action.kind === 'enable') {
        await adminEnableModule(orgId, action.moduleKey, action.skipTrial);
      } else {
        await adminDisableModule(orgId, action.moduleKey);
      }
      setSuccess(t('admin.orgDetail.actionSuccess'));
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
  const stateOf = (moduleKey: string) => entitlements.find((e) => e.moduleKey === moduleKey)?.state ?? 'available';
  const isEnabled = (moduleKey: string) => ENABLED_STATES.has(stateOf(moduleKey));

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
                    <th className="px-4 py-3 text-end font-medium">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(modules ?? []).map((mod) => {
                    const state = stateOf(mod.moduleKey);
                    const enabled = isEnabled(mod.moduleKey);
                    return (
                      <tr key={mod.moduleKey} className="border-b last:border-0 transition-colors hover:bg-accent/40">
                        <td className="px-4 py-3 font-medium">{mod.name}</td>
                        <td className="px-4 py-3">{stateBadge(state, t)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {enabled ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setPending({ kind: 'disable', moduleKey: mod.moduleKey, moduleName: mod.name })
                                }
                              >
                                {t('admin.orgDetail.disable')}
                              </Button>
                            ) : (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setPending({
                                      kind: 'enable',
                                      moduleKey: mod.moduleKey,
                                      moduleName: mod.name,
                                      skipTrial: false,
                                      days: 14,
                                    })
                                  }
                                >
                                  {t('admin.orgDetail.enableTrial')}
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    setPending({
                                      kind: 'enable',
                                      moduleKey: mod.moduleKey,
                                      moduleName: mod.name,
                                      skipTrial: true,
                                      days: 0,
                                    })
                                  }
                                >
                                  {t('admin.orgDetail.enableNow')}
                                </Button>
                              </>
                            )}
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

      {pending?.kind === 'enable' && (
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
    </div>
  );
}
