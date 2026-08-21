'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { NoOrganizationState } from '@/components/shell/no-organization-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/auth/session-context';
import {
  cancelOrganizationDeletion,
  deleteOrganization,
  getMyOrganizations,
  getOrganization,
  updateOrganization,
  updateOrganizationSettings,
} from '@/lib/api/resources';
import { useOrgLocalization } from '@/lib/hooks/use-org-localization';
import { hasPermission } from '@/lib/permissions';

function errorKey(code: string): string {
  switch (code) {
    case 'ORG_SLUG_TAKEN':
      return 'org.errors.slugTaken';
    case 'ORG_ALREADY_PENDING_DELETION':
      return 'settings.org.errors.alreadyPendingDeletion';
    case 'ORG_NOT_PENDING_DELETION':
      return 'settings.org.errors.notPendingDeletion';
    case 'ORG_CANNOT_DELETE_SUSPENDED':
      return 'settings.org.errors.cannotDeleteSuspended';
    case 'FORBIDDEN':
      return 'error.forbidden';
    case 'NOT_FOUND':
      return 'error.notFound';
    case 'NETWORK_ERROR':
      return 'auth.errors.network';
    case 'INTERNAL_ERROR':
      return 'auth.errors.server';
    default:
      return 'auth.errors.unknown';
  }
}

export default function OrganizationSettingsPage() {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { organizationId, switchOrg, permissions } = useSession();

  // AUTHZ-5/BUSINESS_RULES §3: org profile & settings edits are OWNER/ADMIN
  // only, and org deletion is OWNER only. The backend enforces this via
  // @RequiresPermission (OPS-8 — server-authoritative); the UI shows a
  // read-only view to members who lack the permission (UX only).
  const canManageSettings = hasPermission(permissions, 'platform:settings:manage');
  const canDeleteOrg = hasPermission(permissions, 'platform:organization:delete');

  // Organization data for the active org, fetched by id so the cache is keyed
  // to the org being edited (never the JWT's previous org after a switch).
  const { data, isLoading } = useQuery({
    queryKey: ['organization', organizationId],
    queryFn: () => {
      if (organizationId === null) {
        throw new Error('Active organization is not set');
      }
      return getOrganization(organizationId);
    },
    enabled: organizationId !== null,
  });

  // All orgs the user belongs to — powers the switcher on this page.
  const { data: myOrgs } = useQuery({
    queryKey: ['my-organizations'],
    queryFn: getMyOrganizations,
  });

  const {
    countryCode,
    baseCurrency,
    timezone,
    setCountryCode,
    setBaseCurrency,
    setTimezone,
    countryOptions,
    currencyOptions,
    timezoneOptions,
    handleCountryChange,
  } = useOrgLocalization(locale);

  const [name, setName] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [sellerTaxId, setSellerTaxId] = useState('');
  const [taxEnabled, setTaxEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  // Reset hydration state whenever the active org changes, then re-hydrate.
  // Clear the form values too so the previous org's data never lingers while
  // the newly selected org loads (avoids stale/wrong info in the form).
  useEffect(() => {
    setHydrated(false);
    setName('');
    setReceiptFooter('');
    setSellerTaxId('');
    setTaxEnabled(true);
    setCountryCode('');
    setBaseCurrency('');
    setTimezone('');
  }, [organizationId]);

  const org = data?.data;
  const settings = data?.settings;
  const isPendingDeletion = org?.status === 'pending_deletion';

  useEffect(() => {
    if (!org || hydrated) return;
    setName(org.name);
    setCountryCode(org.countryCode);
    setTimezone(org.timezone);
    setBaseCurrency(org.baseCurrency);
    setReceiptFooter(settings?.receiptFooter ?? '');
    setSellerTaxId(settings?.sellerTaxId ?? '');
    setTaxEnabled(settings?.taxEnabled ?? true);
    setHydrated(true);
  }, [org, settings, hydrated]);

  const orgOptions = useMemo<ComboboxOption[]>(
    () =>
      (myOrgs ?? [])
        // Only orgs the user can actively use (membership status). A
        // pending-deletion org keeps its active membership so it survives this
        // filter — keep it explicit so the cancel path can never be dropped.
        .filter((o) => o.status === 'active' || o.organizationStatus === 'pending_deletion')
        .map((o) => {
          const opt: ComboboxOption = { value: o.organizationId, label: o.organizationName };
          // A pending-deletion org stays switchable so its owner can reach it
          // and cancel the deletion (GDPR-2); flag it so it's not mistaken for
          // a regular org. The 'Current' hint loses to the deletion label.
          if (o.organizationStatus === 'pending_deletion') {
            opt.hint = t('settings.org.pendingDeletion');
          } else if (o.current) {
            opt.hint = t('settings.org.currentOrg');
          }
          return opt;
        }),
    [myOrgs, t],
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (organizationId === null) return;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      // Sequential two-call save: both routes require platform:settings:manage
      // (same permission, so a viewer can no longer pass the first call), but a
      // transient failure on the SECOND call can still leave the profile fields
      // persisted while the UI shows an error — the partial-write behavior is
      // intentional for now; a single combined endpoint would remove it.
      await updateOrganization(organizationId, { name, countryCode, timezone, baseCurrency });
      await updateOrganizationSettings(organizationId, {
        receiptFooter: receiptFooter || null,
        sellerTaxId: sellerTaxId || null,
        taxEnabled,
      });
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
      setNotice('settings.saved');
    } catch (err) {
      setError(err instanceof ApiError ? errorKey(err.code) : 'auth.errors.unknown');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (organizationId === null) return;
    if (!window.confirm(t('settings.org.deleteConfirm'))) return;
    setIsDeleting(true);
    setError(null);
    setNotice(null);
    try {
      await deleteOrganization(organizationId);
      setNotice('settings.org.deletionScheduled');
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
    } catch (err) {
      // The org may already be pending deletion (e.g. scheduled from an earlier
      // attempt or another session). Refetch so the pending-deletion banner and
      // Cancel button appear immediately instead of leaving the user stuck on a
      // generic error with no way forward.
      if (err instanceof ApiError && err.code === 'ORG_ALREADY_PENDING_DELETION') {
        await queryClient.invalidateQueries({ queryKey: ['organization'] });
      }
      setError(err instanceof ApiError ? errorKey(err.code) : 'auth.errors.unknown');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCancelDeletion = async () => {
    if (organizationId === null) return;
    if (!window.confirm(t('settings.org.cancelDeletionConfirm'))) return;
    setIsCanceling(true);
    setError(null);
    setNotice(null);
    try {
      await cancelOrganizationDeletion(organizationId);
      setNotice('settings.org.deletionCanceled');
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
    } catch (err) {
      // Deletion may have been cancelled already (or was never scheduled).
      // Refetch so the UI reflects the true state.
      if (err instanceof ApiError && err.code === 'ORG_NOT_PENDING_DELETION') {
        await queryClient.invalidateQueries({ queryKey: ['organization'] });
      }
      setError(err instanceof ApiError ? errorKey(err.code) : 'auth.errors.unknown');
    } finally {
      setIsCanceling(false);
    }
  };

  const handleSwitchOrg = async (orgId: string) => {
    if (orgId === organizationId) return;
    setIsSwitching(true);
    try {
      await switchOrg(orgId);
      // Only the org-scoped caches need refreshing — invalidating everything
      // refetches unrelated modules and makes the switch feel sluggish.
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
      await queryClient.invalidateQueries({ queryKey: ['my-organizations'] });
      await queryClient.invalidateQueries({ queryKey: ['navigation'] });
      await queryClient.invalidateQueries({ queryKey: ['entitlements'] });
    } finally {
      setIsSwitching(false);
    }
  };

  if (organizationId === null) return <NoOrganizationState />;

  const activeOrgLabel = orgOptions.find((o) => o.value === organizationId)?.label;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.sections.organization')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.descriptions.organization')}</p>
      </div>

      {/* Org switcher */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="org-switcher">{t('settings.org.switchOrgLabel')}</Label>
              <Combobox
                id="org-switcher"
                options={orgOptions}
                value={organizationId}
                onValueChange={(v) => void handleSwitchOrg(v)}
                placeholder={t('settings.org.selectOrg')}
                searchPlaceholder={t('settings.org.searchOrg')}
                emptyText={t('common.noResults')}
                disabled={isSwitching}
              />
            </div>
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
              <Building2 className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{activeOrgLabel ?? org?.name ?? t('shell.loading')}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">{t('shell.loading')}</p>}

      {isPendingDeletion && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {t('settings.org.pendingDeletion')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('settings.org.pendingDeletionHint', {
                date: org?.deletionScheduledAt ? new Date(org.deletionScheduledAt).toLocaleDateString(locale) : '',
              })}
            </p>
            {canDeleteOrg && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => void handleCancelDeletion()}
                loading={isCanceling}
              >
                {t('settings.org.cancelDeletion')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {canManageSettings ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('settings.org.profileTitle')}</CardTitle>
            <CardDescription>{t('settings.org.profileSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="org-name">{t('org.name')}</Label>
                <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="org-country">{t('org.country')}</Label>
                  <Combobox
                    id="org-country"
                    options={countryOptions}
                    value={countryCode}
                    onValueChange={handleCountryChange}
                    placeholder={t('settings.org.selectCountry')}
                    searchPlaceholder={t('settings.org.searchCountry')}
                    emptyText={t('common.noResults')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-currency">{t('org.currency')}</Label>
                  <Combobox
                    id="org-currency"
                    options={currencyOptions}
                    value={baseCurrency}
                    onValueChange={setBaseCurrency}
                    placeholder={t('settings.org.selectCurrency')}
                    searchPlaceholder={t('settings.org.searchCurrency')}
                    emptyText={t('common.noResults')}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-timezone">{t('settings.org.timezone')}</Label>
                <Combobox
                  id="org-timezone"
                  options={timezoneOptions}
                  value={timezone}
                  onValueChange={setTimezone}
                  placeholder={t('settings.org.selectTimezone')}
                  searchPlaceholder={t('settings.org.searchTimezone')}
                  emptyText={t('common.noResults')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-receipt-footer">{t('settings.org.receiptFooter')}</Label>
                <Input
                  id="org-receipt-footer"
                  value={receiptFooter}
                  onChange={(e) => setReceiptFooter(e.target.value)}
                  maxLength={500}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-seller-tax-id">{t('settings.org.sellerTaxId')}</Label>
                <Input
                  id="org-seller-tax-id"
                  dir="auto"
                  value={sellerTaxId}
                  onChange={(e) => setSellerTaxId(e.target.value)}
                  maxLength={50}
                />
                <p className="text-xs text-muted-foreground">{t('settings.org.sellerTaxIdHint')}</p>
              </div>
              <label className="flex items-start gap-3 rounded-md border p-3">
                <input
                  id="org-tax-enabled"
                  type="checkbox"
                  checked={taxEnabled}
                  onChange={(e) => setTaxEnabled(e.target.checked)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">{t('settings.org.taxEnabled')}</span>
                  <span className="block text-xs text-muted-foreground">{t('settings.org.taxEnabledHint')}</span>
                </span>
              </label>
              {error && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {t(error)}
                </p>
              )}
              {notice && (
                <p
                  role="status"
                  className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400"
                >
                  {t(notice)}
                </p>
              )}
              <Button type="submit" loading={isSaving}>
                {t('common.save')}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('settings.org.profileTitle')}</CardTitle>
            <CardDescription>{t('settings.org.profileSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {t('settings.org.readOnlyHint')}
            </p>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t('org.name')}</dt>
                <dd className="font-medium">{org?.name}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t('org.country')}</dt>
                <dd className="font-medium">{org?.countryCode}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t('org.currency')}</dt>
                <dd className="font-medium">{org?.baseCurrency}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t('settings.org.timezone')}</dt>
                <dd className="font-medium">{org?.timezone}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      {canDeleteOrg && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base text-destructive">{t('settings.org.dangerZone')}</CardTitle>
            <CardDescription>{t('settings.org.dangerZoneHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isPendingDeletion ? (
              <Button variant="outline" onClick={() => void handleCancelDeletion()} loading={isCanceling}>
                {t('settings.org.cancelDeletion')}
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => void handleDelete()} loading={isDeleting}>
                {t('settings.org.deleteOrganization')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
