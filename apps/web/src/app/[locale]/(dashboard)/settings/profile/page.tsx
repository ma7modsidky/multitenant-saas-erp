'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';


import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { routing } from '@/i18n/routing';
import { ApiError } from '@/lib/api';
import { changePassword, updateProfile } from '@/lib/auth';
import { useSession } from '@/lib/auth/session-context';

export default function ProfileSettingsPage() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const { user, setUser } = useSession();

  const [name, setName] = useState(user?.name ?? '');
  const [preferredLocale, setPreferredLocale] = useState(user?.preferredLocale ?? 'en');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwNotice, setPwNotice] = useState<string | null>(null);
  const [isChanging, setIsChanging] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateProfile({ name, preferredLocale });
      setUser(updated);
      setNotice('settings.saved');
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof ApiError ? 'settings.errors.saveFailed' : 'auth.errors.unknown');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsChanging(true);
    setPwError(null);
    setPwNotice(null);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setPwNotice('settings.saved');
    } catch (err) {
      setPwError(
        err instanceof ApiError && err.code === 'AUTH_INVALID_CREDENTIALS' ? 'settings.errors.currentPassword' : 'auth.errors.unknown',
      );
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.sections.profile')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.descriptions.profile')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings.profile.detailsTitle')}</CardTitle>
          <CardDescription>{t('settings.profile.detailsSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-name">{t('common.name')}</Label>
              <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-email">{t('auth.email')}</Label>
              <Input id="profile-email" value={user?.email ?? ''} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-locale">{t('settings.profile.locale')}</Label>
              <Select
                id="profile-locale"
                value={preferredLocale}
                onValueChange={setPreferredLocale}
              >
                {routing.locales.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code.toUpperCase()}
                  </SelectItem>
                ))}
              </Select>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settings.profile.passwordTitle')}</CardTitle>
          <CardDescription>{t('settings.profile.passwordSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handlePassword(e)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">{t('settings.profile.currentPassword')}</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">{t('auth.newPassword')}</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
              />
            </div>
            {pwError && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {t(pwError)}
              </p>
            )}
            {pwNotice && (
              <p role="status" className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
                {t(pwNotice)}
              </p>
            )}
            <Button type="submit" loading={isChanging}>
              {t('settings.profile.changePassword')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
