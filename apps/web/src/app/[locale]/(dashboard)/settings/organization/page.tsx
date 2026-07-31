'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';


import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import {
  deleteOrganization,
  getActiveOrganization,
  updateOrganization,
  updateOrganizationSettings,
} from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';

function errorKey(code: string): string {
  switch (code) {
    case 'ORG_SLUG_TAKEN':
      return 'org.errors.slugTaken';
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
  const queryClient = useQueryClient();
  const { organizationId } = useSession();

  const { data, isLoading } = useQuery({
    queryKey: ['organization', organizationId],
    queryFn: () => getActiveOrganization(),
    enabled: organizationId !== null,
  });

  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [timezone, setTimezone] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (organizationId === null) return null;

  const org = data?.data;
  const settings = data?.settings;
  if (org && name === '' && name !== org.name) {
    setName(org.name);
    setCountryCode(org.countryCode);
    setTimezone(org.timezone);
    setBaseCurrency(org.baseCurrency);
    setReceiptFooter(settings?.receiptFooter ?? '');
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      await updateOrganization(organizationId, { name, countryCode, timezone, baseCurrency });
      await updateOrganizationSettings(organizationId, { receiptFooter: receiptFooter || null });
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
      setNotice('settings.saved');
    } catch (err) {
      setError(err instanceof ApiError ? errorKey(err.code) : 'auth.errors.unknown');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('settings.org.deleteConfirm'))) return;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteOrganization(organizationId);
      setNotice('settings.org.deletionScheduled');
      await queryClient.invalidateQueries({ queryKey: ['organization'] });
    } catch (err) {
      setError(err instanceof ApiError ? errorKey(err.code) : 'auth.errors.unknown');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.sections.organization')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.descriptions.organization')}</p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t('shell.loading')}</p>}

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
                <Input
                  id="org-country"
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                  required
                  maxLength={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-currency">{t('org.currency')}</Label>
                <Input
                  id="org-currency"
                  value={baseCurrency}
                  onChange={(e) => setBaseCurrency(e.target.value.toUpperCase())}
                  required
                  maxLength={3}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-timezone">{t('settings.org.timezone')}</Label>
              <Input id="org-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} required />
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
            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {t(error)}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
                {t(notice)}
              </p>
            )}
            <Button type="submit" loading={isSaving}>
              {t('common.save')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive">{t('settings.org.dangerZone')}</CardTitle>
          <CardDescription>{t('settings.org.dangerZoneHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => void handleDelete()} loading={isDeleting}>
            {t('settings.org.deleteOrganization')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
