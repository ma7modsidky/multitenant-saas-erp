'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { getAdminSettings, updateAdminSettings, type AdminSaasSettings } from '@/lib/api/resources';

export default function AdminSettingsPage() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-settings'], queryFn: getAdminSettings });

  const [form, setForm] = useState<AdminSaasSettings>({
    platformName: '',
    supportEmail: '',
    trialDurationDays: 14,
    allowSelfSignup: true,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await updateAdminSettings({
        platformName: form.platformName,
        supportEmail: form.supportEmail,
        trialDurationDays: form.trialDurationDays,
        allowSelfSignup: form.allowSelfSignup,
      });
      setMessage({ type: 'success', text: t('admin.settings.saved') });
      await queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
    } catch (err) {
      setMessage({
        type: 'error',
        text:
          err instanceof ApiError && err.code === 'NETWORK_ERROR'
            ? t('auth.errors.network')
            : t('admin.settings.saveFailed'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('admin.settings.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.settings.subtitle')}</p>
      </div>

      {message && (
        <p
          role="status"
          className={
            message.type === 'error'
              ? 'rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive'
              : 'rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400'
          }
        >
          {message.text}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('admin.settings.title')}</CardTitle>
          <CardDescription>{t('admin.settings.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading || !data ? (
            <>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="platformName">{t('admin.settings.platformName')}</Label>
                <Input
                  id="platformName"
                  value={form.platformName}
                  onChange={(e) => setForm((prev) => ({ ...prev, platformName: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">{t('admin.settings.platformNameHint')}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="supportEmail">{t('admin.settings.supportEmail')}</Label>
                <Input
                  id="supportEmail"
                  type="email"
                  value={form.supportEmail}
                  onChange={(e) => setForm((prev) => ({ ...prev, supportEmail: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">{t('admin.settings.supportEmailHint')}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="trialDurationDays">{t('admin.settings.trialDurationDays')}</Label>
                <Input
                  id="trialDurationDays"
                  type="number"
                  min={1}
                  max={365}
                  value={form.trialDurationDays}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      trialDurationDays: Number(e.target.value),
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground">{t('admin.settings.trialDurationDaysHint')}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="allowSelfSignup">{t('admin.settings.allowSelfSignup')}</Label>
                <select
                  id="allowSelfSignup"
                  value={form.allowSelfSignup ? 'true' : 'false'}
                  onChange={(e) => setForm((prev) => ({ ...prev, allowSelfSignup: e.target.value === 'true' }))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="true">{t('common.yes')}</option>
                  <option value="false">{t('common.no')}</option>
                </select>
                <p className="text-xs text-muted-foreground">{t('admin.settings.allowSelfSignupHint')}</p>
              </div>
            </>
          )}

          <div className="flex justify-end pt-2">
            <Button onClick={() => void save()} disabled={saving || isLoading || !data}>
              {t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
