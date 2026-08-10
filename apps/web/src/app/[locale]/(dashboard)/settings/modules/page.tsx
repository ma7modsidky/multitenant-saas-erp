'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NoOrganizationState } from '@/components/shell/no-organization-state';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { disableBillingModule, enableModuleTrial, getModuleCatalog } from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';
import { useEntitlements } from '@/lib/entitlements';

/**
 * Whole days remaining in a free trial (ceiling, so the final partial day
 * still counts). 0 once the end date has passed.
 */
function trialDaysLeft(trialEndsAt: string): number {
  const end = new Date(trialEndsAt).getTime();
  if (Number.isNaN(end)) return 0;
  const ms = end - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default function ModulesSettingsPage() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const { organizationId } = useSession();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const { data: catalog } = useQuery({ queryKey: ['module-catalog'], queryFn: getModuleCatalog });
  const { data: billing } = useEntitlements();

  if (organizationId === null) return <NoOrganizationState />;

  const entitlements = billing?.entitlements ?? [];
  const enabledStates = ['active', 'trialing', 'past_due'];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['entitlements'] });

  const handleStartTrial = async (moduleKey: string) => {
    setErrorCode(null);
    try {
      await enableModuleTrial(organizationId, moduleKey);
      await invalidate();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        window.alert(t('auth.errors.network'));
        return;
      }
      // Surface the backend error code so a failed trial is never silent.
      setErrorCode(err instanceof ApiError ? err.code : 'UNKNOWN');
    }
  };

  const handleDisable = async (moduleKey: string) => {
    if (!window.confirm(t('billing.confirmDisable'))) return;
    setErrorCode(null);
    try {
      await disableBillingModule(organizationId, moduleKey);
      await invalidate();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        window.alert(t('auth.errors.network'));
        return;
      }
      setErrorCode(err instanceof ApiError ? err.code : 'UNKNOWN');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.sections.modules')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.descriptions.modules')}</p>
      </div>

      {errorCode && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {t('modules.startTrialError', { code: errorCode })}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(catalog ?? []).map((mod) => {
          const entitlement = entitlements.find((e) => e.moduleKey === mod.key);
          const state = entitlement?.state ?? 'none';
          const enabled = enabledStates.includes(state);
          // Live countdown for modules actually in trial (BILL-2) — the card
          // switches from the static trial-length line to days remaining.
          // Falls back to the static line once the trial has run out.
          const trialEnd = entitlement?.state === 'trialing' ? entitlement.trialEndsAt : null;
          const trialRemaining = trialEnd ? trialDaysLeft(trialEnd) : 0;
          return (
            <Card key={mod.key}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{t(mod.nameKey)}</CardTitle>
                  <Badge variant={enabled ? 'default' : 'outline'}>{state}</Badge>
                </div>
                {mod.descriptionKey && <CardDescription>{t(mod.descriptionKey)}</CardDescription>}
              </CardHeader>
              <CardContent>
                {mod.trialDays > 0 && (
                  <p className="mb-4 text-xs text-muted-foreground">
                    {trialRemaining > 0
                      ? t('modules.trialDaysLeft', { count: trialRemaining })
                      : t('modules.trialDays', { days: mod.trialDays })}
                  </p>
                )}
                {enabled ? (
                  <Button variant="outline" className="w-full" onClick={() => void handleDisable(mod.key)}>
                    {t('billing.disable')}
                  </Button>
                ) : (
                  <Button className="w-full" onClick={() => void handleStartTrial(mod.key)}>
                    {t('modules.startTrial')}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
        {(catalog ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t('modules.noModules')}</p>}
      </div>
    </div>
  );
}
