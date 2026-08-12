'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { NoOrganizationState } from '@/components/shell/no-organization-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ApiError } from '@/lib/api';
import { disableBillingModule, enableModuleTrial, getModuleCatalog } from '@/lib/api/resources';
import type { ModuleDefinition } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session-context';
import { useEntitlements } from '@/lib/entitlements';
import { ModuleStateBadge } from '@/lib/entitlements/module-state-badge';

/** States that grant any level of access (full or read-only). */
const ENABLED_STATES = ['active', 'trialing', 'past_due'];

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

/** Locale-aware list join: ['Inventory', 'CRM'] → "Inventory and CRM". */
function listNames(names: string[], locale: string): string {
  if (names.length <= 1) return names[0] ?? '';
  try {
    return new Intl.ListFormat(locale, { type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}

/**
 * Friendly i18n key for a failed enable/disable. Raw backend codes never
 * surface to the user — the code is mapped to a message that names the
 * operation (a disable error must never say "could not start the trial").
 */
function actionErrorKey(code: string, action: 'enable' | 'disable'): string {
  switch (code) {
    case 'MODULE_DEPENDENCY_MISSING':
      return 'modules.dependencyMissing';
    case 'MODULE_DEPENDENCY_CONFLICT':
      return 'modules.dependencyConflict';
    // TRIAL_ALREADY_USED can only be raised by the enable use case — mapping
    // it onto a disable failure would be nonsense, so fall through there.
    case 'TRIAL_ALREADY_USED':
      return action === 'enable' ? 'modules.trialAlreadyUsed' : 'modules.disableFailed';
    default:
      return action === 'enable' ? 'modules.enableFailed' : 'modules.disableFailed';
  }
}

/** A module action awaiting confirmation in the dialog. */
type PendingAction =
  | { kind: 'enable'; module: ModuleDefinition; deps: ModuleDefinition[] }
  | { kind: 'disable'; module: ModuleDefinition; dependents: ModuleDefinition[] };

export default function ModulesSettingsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { organizationId } = useSession();
  // Per-card inline errors (moduleKey → resolved message). Inline on the card
  // beats the old single page-level banner: the failing module is obvious.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: catalog } = useQuery({ queryKey: ['module-catalog'], queryFn: getModuleCatalog });
  const { data: billing } = useEntitlements();

  if (organizationId === null) return <NoOrganizationState />;

  const entitlements = billing?.entitlements ?? [];
  const isEnabled = (moduleKey: string) =>
    ENABLED_STATES.includes(entitlements.find((e) => e.moduleKey === moduleKey)?.state ?? 'none');

  const moduleName = (moduleKey: string) => t(`modules.${moduleKey}.name`);
  const moduleByKey = (moduleKey: string) => catalog?.find((m) => m.key === moduleKey);
  const namesOf = (modules: ModuleDefinition[]) =>
    listNames(
      modules.map((m) => moduleName(m.key)),
      locale,
    );

  // RTL-aware list separator for the inline Requires line (the dialog lists
  // go through Intl.ListFormat in listNames).
  const listSeparator = locale.startsWith('ar') ? '، ' : ', ';

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['entitlements'] });

  const clearError = (moduleKey: string) =>
    setErrors((prev) => {
      const next = { ...prev };
      delete next[moduleKey];
      return next;
    });

  /** Resolve the user-facing message for an enable/disable failure. */
  const errorMessage = (err: unknown, module: ModuleDefinition, action: 'enable' | 'disable'): string => {
    const code = err instanceof ApiError ? err.code : 'UNKNOWN';
    if (code === 'MODULE_DEPENDENCY_MISSING') {
      const deps = module.dependsOn.map(moduleByKey).filter((m): m is ModuleDefinition => m !== undefined);
      return t('modules.dependencyMissing', {
        module: moduleName(module.key),
        dependency: namesOf(deps),
      });
    }
    if (code === 'MODULE_DEPENDENCY_CONFLICT') {
      // The server rejected — its view is authoritative, so list every catalog
      // module that depends on this one (client entitlements may be stale).
      const dependents = (catalog ?? []).filter((m) => m.dependsOn.includes(module.key));
      return t('modules.dependencyConflict', {
        module: moduleName(module.key),
        dependents: namesOf(dependents),
      });
    }
    return t(actionErrorKey(code, action));
  };

  const runAction = async (action: 'enable' | 'disable', module: ModuleDefinition, related: ModuleDefinition[]) => {
    setBusy(true);
    try {
      // Dependencies/dependents go FIRST so the target module's invariant is
      // satisfied at every step (the server would reject the target otherwise).
      for (const rel of related) {
        if (action === 'enable') await enableModuleTrial(organizationId, rel.key);
        else await disableBillingModule(organizationId, rel.key);
      }
      if (action === 'enable') await enableModuleTrial(organizationId, module.key);
      else await disableBillingModule(organizationId, module.key);
      await invalidate();
      setPending(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        window.alert(t('auth.errors.network'));
        setPending(null);
        return;
      }
      setErrors((prev) => ({ ...prev, [module.key]: errorMessage(err, module, action) }));
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const startEnable = (module: ModuleDefinition) => {
    clearError(module.key);
    // Pre-check dependencies client-side (the catalog carries them) and offer
    // to activate the missing ones instead of hitting a server error.
    const missingDeps = module.dependsOn
      .map(moduleByKey)
      .filter((m): m is ModuleDefinition => m !== undefined && !isEnabled(m.key));
    if (missingDeps.length > 0) {
      setPending({ kind: 'enable', module, deps: missingDeps });
      return;
    }
    void runAction('enable', module, []);
  };

  const startDisable = (module: ModuleDefinition) => {
    clearError(module.key);
    // Modules that depend on this one and are currently enabled would break —
    // offer to disable them together instead of a server-side rejection.
    const dependents = (catalog ?? []).filter((m) => m.dependsOn.includes(module.key) && isEnabled(m.key));
    setPending({ kind: 'disable', module, dependents });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.sections.modules')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.descriptions.modules')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(catalog ?? []).map((mod) => {
          const entitlement = entitlements.find((e) => e.moduleKey === mod.key);
          const state = entitlement?.state ?? 'none';
          const enabled = isEnabled(mod.key);
          // Dependencies as catalog rows (for the Requires line + missing tint).
          const deps = mod.dependsOn.map(moduleByKey).filter((m): m is ModuleDefinition => m !== undefined);
          // Live countdown for modules actually in trial (BILL-2) — the card
          // switches from the static trial-length line to days remaining.
          const trialEnd = entitlement?.state === 'trialing' ? entitlement.trialEndsAt : null;
          const trialRemaining = trialEnd ? trialDaysLeft(trialEnd) : 0;
          return (
            <Card key={mod.key} className="flex flex-col" data-testid={`module-card-${mod.key}`}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{t(mod.nameKey)}</CardTitle>
                  <ModuleStateBadge state={state} />
                </div>
                {mod.descriptionKey && <CardDescription>{t(mod.descriptionKey)}</CardDescription>}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                {deps.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('modules.requiresLabel')}{' '}
                    {deps.map((dep, index) => {
                      const active = isEnabled(dep.key);
                      return (
                        <span key={dep.key}>
                          {index > 0 && <span>{listSeparator}</span>}
                          {/* A required module that is not active is the reason
                              this card can't be enabled yet — highlight it and
                              say so in words, not color alone. */}
                          <span className={active ? '' : 'font-medium text-amber-600 dark:text-amber-400'}>
                            {t(`modules.${dep.key}.name`)}
                            {!active && <span> {t('modules.dependencyNotActive')}</span>}
                          </span>
                        </span>
                      );
                    })}
                  </p>
                )}
                {/* Trial line: LIVE countdown for modules actually in trial
                    (BILL-2); static offer for not-yet-activated ones. Paid
                    (active) and past_due cards show neither. */}
                {(state === 'trialing' || !enabled) && mod.trialDays > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {trialRemaining > 0
                      ? t('modules.trialDaysLeft', { count: trialRemaining })
                      : t('modules.trialDays', { days: mod.trialDays })}
                  </p>
                )}
                {errors[mod.key] && (
                  <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {errors[mod.key]}
                  </p>
                )}
                <div className="mt-auto">
                  {enabled ? (
                    <Button variant="outline" className="w-full" onClick={() => startDisable(mod)}>
                      {t('billing.disable')}
                    </Button>
                  ) : (
                    <Button className="w-full" onClick={() => startEnable(mod)}>
                      {t('modules.startTrial')}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {(catalog ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t('modules.noModules')}</p>}
      </div>

      {/* Enable dialog — a module whose required modules aren't active yet:
          offer to activate them together instead of failing. */}
      {pending?.kind === 'enable' && (
        <ConfirmDialog
          open
          title={t('modules.enableDepsTitle', { module: moduleName(pending.module.key) })}
          description={t('modules.enableDepsBody', {
            module: moduleName(pending.module.key),
            modules: namesOf(pending.deps),
          })}
          confirmLabel={t('modules.enableDepsConfirm', { modules: namesOf(pending.deps) })}
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          loading={busy}
          onConfirm={() => void runAction('enable', pending.module, pending.deps)}
          onCancel={() => setPending(null)}
        />
      )}

      {/* Disable dialog — confirm the removal, and when other enabled modules
          depend on this one, warn that they will be disabled too. */}
      {pending?.kind === 'disable' && (
        <ConfirmDialog
          open
          destructive
          title={t('modules.disableConfirmTitle', { module: moduleName(pending.module.key) })}
          description={
            pending.dependents.length > 0
              ? t('modules.disableDepsBody', {
                  module: moduleName(pending.module.key),
                  modules: namesOf(pending.dependents),
                })
              : t('billing.confirmDisable')
          }
          confirmLabel={
            pending.dependents.length > 0
              ? t('modules.disableDepsConfirm', { modules: namesOf(pending.dependents) })
              : t('billing.disable')
          }
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          loading={busy}
          onConfirm={() => void runAction('disable', pending.module, pending.dependents)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
