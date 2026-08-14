'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AccessDenied } from '@/components/shell/access-denied';
import { NoOrganizationState } from '@/components/shell/no-organization-state';
import { disableBillingModule, getBilling } from '@/lib/api/resources';
import type { Entitlement } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session-context';
import { ModuleStateBadge } from '@/lib/entitlements';
import { hasPermission } from '@/lib/permissions';
import { trialDaysLeft } from '@/lib/trial';

export default function BillingSettingsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { organizationId, permissions } = useSession();

  // AUTHZ-2/UX: this page is OWNER/ADMIN-only. The backend enforces every
  // action via @RequiresPermission (OPS-8 — server-authoritative); this gate
  // covers direct-URL navigation by members.
  const canManageBilling = hasPermission(permissions, 'platform:billing:manage');

  const { data: billing } = useQuery({
    queryKey: ['entitlements', organizationId],
    queryFn: () => {
      if (organizationId === null) throw new Error('No organization selected');
      return getBilling(organizationId);
    },
    enabled: organizationId !== null,
  });

  if (organizationId === null) return <NoOrganizationState />;
  if (!canManageBilling) return <AccessDenied />;

  const subscription = billing?.subscription ?? null;
  const entitlements = billing?.entitlements ?? [];

  const handleDisable = async (moduleKey: string) => {
    if (!window.confirm(t('billing.confirmDisable'))) return;
    await disableBillingModule(organizationId, moduleKey);
    await queryClient.invalidateQueries({ queryKey: ['entitlements'] });
  };

  /**
   * Trial status line per entitlement: end date + days left for an active
   * trial, the ended date once it lapsed, and a bare "Trial used" for a
   * module disabled after its trial (BILL-2). Paid states show nothing.
   * The active-trial line is assembled from a translator-controlled template
   * (billing.trialActive) so RTL locales can order the countdown first.
   */
  const trialInfo = (ent: Entitlement): string | null => {
    if (ent.state === 'trialing' && ent.trialEndsAt) {
      return t('billing.trialActive', {
        endsAt: t('billing.trialEndsAt', { date: new Date(ent.trialEndsAt).toLocaleDateString(locale) }),
        daysLeft: t('modules.trialDaysLeft', { count: trialDaysLeft(ent.trialEndsAt) }),
      });
    }
    if (ent.state === 'expired' && ent.trialEndsAt) {
      return t('billing.trialEnded', { date: new Date(ent.trialEndsAt).toLocaleDateString(locale) });
    }
    if (ent.state === 'disabled' && ent.trialStartedAt) {
      return t('billing.trialUsed');
    }
    return null;
  };

  /**
   * Expiry line for ACTIVE modules: a paid module renews at the shared
   * subscription period end (BILL-1 — every item renews together), and a free
   * admin grant expires at its accessUntil date (PLT-8/BILL-14). Unlimited
   * grants show nothing extra — the badge alone reads "Active".
   */
  const accessInfo = (ent: Entitlement, periodEnd: string | null): string | null => {
    if (ent.state !== 'active') return null;
    if (ent.isPaid && periodEnd) {
      return t('billing.paidUntil', { date: new Date(periodEnd).toLocaleDateString(locale) });
    }
    if (!ent.isPaid && ent.accessUntil) {
      return t('billing.grantAccessUntil', { date: new Date(ent.accessUntil).toLocaleDateString(locale) });
    }
    return null;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.sections.billing')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.descriptions.billing')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('billing.subscriptionTitle')}</CardTitle>
          <CardDescription>{t('billing.subscriptionSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {subscription ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">{t('billing.status')}</dt>
                <dd className="mt-1 text-sm font-medium">{subscription.status}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">{t('billing.currency')}</dt>
                <dd className="mt-1 text-sm font-medium">{subscription.billingCurrency}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">{t('billing.periodEnd')}</dt>
                <dd className="mt-1 text-sm font-medium">
                  {subscription.currentPeriodEnd
                    ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                    : t('billing.noPeriodEnd')}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{t('billing.noSubscription')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('billing.entitlementsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {entitlements.map((ent) => {
              const trial = trialInfo(ent);
              const access = accessInfo(ent, subscription?.currentPeriodEnd ?? null);
              return (
                <li key={ent.moduleKey} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-medium">{t(`modules.${ent.moduleKey}.name`)}</p>
                      <ModuleStateBadge state={ent.state} />
                    </div>
                    {(trial ?? access) && <p className="mt-0.5 text-xs text-muted-foreground">{trial ?? access}</p>}
                  </div>
                  {ent.state !== 'none' && (
                    <Button variant="outline" size="sm" onClick={() => void handleDisable(ent.moduleKey)}>
                      {t('billing.disable')}
                    </Button>
                  )}
                </li>
              );
            })}
            {entitlements.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">{t('billing.noEntitlements')}</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
