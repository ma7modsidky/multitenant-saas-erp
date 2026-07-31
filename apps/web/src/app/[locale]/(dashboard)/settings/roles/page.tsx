'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';


import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { createRole, getRoleMatrix } from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';

export default function RolesSettingsPage() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const { organizationId } = useSession();

  const { data: matrix } = useQuery({
    queryKey: ['role-matrix', organizationId],
    queryFn: () => {
      if (organizationId === null) throw new Error('No organization selected');
      return getRoleMatrix(organizationId);
    },
    enabled: organizationId !== null,
  });

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  if (organizationId === null) return null;

  const permissionCatalog = matrix?.permissionCatalog ?? [];
  const systemRoles = matrix?.systemRoles ?? [];
  const customRoles = matrix?.customRoles ?? [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);
    setNotice(null);
    try {
      await createRole(organizationId, { key, nameI18n: { en: name } });
      setKey('');
      setName('');
      setNotice('roles.created');
      await queryClient.invalidateQueries({ queryKey: ['role-matrix'] });
    } catch (err) {
      setError(err instanceof ApiError ? 'roles.errors.createFailed' : 'auth.errors.unknown');
    } finally {
      setIsCreating(false);
    }
  };

  const allRoles = [
    ...systemRoles.map((r) => ({ key: r.key, name: r.key, permissions: r.permissions, system: true })),
    ...customRoles.map((r) => ({ key: r.key, name: r.nameI18n?.en ?? r.key, permissions: r.permissions, system: false })),
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.sections.roles')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.descriptions.roles')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('roles.createTitle')}</CardTitle>
          <CardDescription>{t('roles.createSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleCreate(e)} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="role-key">{t('roles.key')}</Label>
              <Input
                id="role-key"
                value={key}
                onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z_]/g, ''))}
                required
                pattern="^[a-z_]+$"
                placeholder="sales_manager"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="role-name">{t('roles.name')}</Label>
              <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <Button type="submit" loading={isCreating}>
              {t('roles.create')}
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t(error)}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
              {t(notice)}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('roles.matrixTitle')}</CardTitle>
          <CardDescription>{t('roles.matrixSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pe-4 text-start font-medium text-muted-foreground">{t('roles.permission')}</th>
                {allRoles.map((role) => (
                  <th key={role.key} className="px-2 py-2 text-start font-medium">
                    {role.name}
                    {role.system && <span className="ms-1 text-xs text-muted-foreground">({t('roles.system')})</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissionCatalog.length === 0 && (
                <tr>
                  <td colSpan={allRoles.length + 1} className="py-6 text-center text-muted-foreground">
                    {t('roles.noPermissions')}
                  </td>
                </tr>
              )}
              {permissionCatalog.map((keyName) => (
                <tr key={keyName} className="border-b last:border-0">
                  <td className="py-2 pe-4 font-mono text-xs">{keyName}</td>
                  {allRoles.map((role) => (
                    <td key={role.key} className="px-2 py-2 text-center">
                      {role.permissions.includes(keyName) ||
                      role.permissions.includes(keyName.replace(/:[^:]+$/, '') + ':manage')
                        ? '✓'
                        : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
