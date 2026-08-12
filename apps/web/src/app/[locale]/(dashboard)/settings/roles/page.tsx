'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AccessDenied } from '@/components/shell/access-denied';
import { NoOrganizationState } from '@/components/shell/no-organization-state';
import { roleErrorKey } from '@/lib/api/error-keys';
import { createRole, deleteRole, getRoleMatrix, updateRole } from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';
import { hasPermission } from '@/lib/permissions';

/** One column of the matrix — a system role (id null, immutable) or a custom role. */
interface MatrixRole {
  id: string | null;
  key: string;
  name: string;
  permissions: string[];
  system: boolean;
}

/**
 * Area-level `:manage` grant check: a role holding `crm:contact:manage` is
 * shown as having `crm:contact:read`/`write` (same heuristic as the seeded
 * system-role matrix). The permission catalog stores exact keys; this is a
 * display shortcut, and toggles resolve against it so the editor never shows
 * a state the backend wouldn't grant.
 */
function hasPermissionKey(keys: readonly string[], permission: string): boolean {
  return keys.includes(permission) || keys.includes(permission.replace(/:[^:]+$/, '') + ':manage');
}

export default function RolesSettingsPage() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const { organizationId, permissions } = useSession();

  // AUTHZ-2/UX: this page is OWNER/ADMIN-only. The backend enforces every
  // action via @RequiresPermission (OPS-8 — server-authoritative); this gate
  // covers direct-URL navigation by members.
  const canManageRoles = hasPermission(permissions, 'platform:roles:manage');

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
  // Create-card feedback vs matrix feedback are separate: save/delete errors
  // must surface NEXT to the matrix where the action happened.
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const [matrixNotice, setMatrixNotice] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Un-saved permission drafts per custom role id (exact keys). A role only
  // appears here once the user toggles a cell; Save is shown per column.
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MatrixRole | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  if (organizationId === null) return <NoOrganizationState />;
  if (!canManageRoles) return <AccessDenied />;

  const platformPermissions = matrix?.platformPermissions ?? [];
  const permissionCatalog = matrix?.permissionCatalog ?? [];
  const systemRoles = matrix?.systemRoles ?? [];
  const customRoles = matrix?.customRoles ?? [];

  const allRoles: MatrixRole[] = [
    ...systemRoles.map((r) => ({ id: null, key: r.key, name: r.key, permissions: r.permissions, system: true })),
    ...customRoles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.nameI18n?.en ?? r.key,
      permissions: r.permissions,
      system: false,
    })),
  ];

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
      setError(roleErrorKey(err));
    } finally {
      setIsCreating(false);
    }
  };

  /** Draft permission keys for a role (falls back to the saved set). */
  const draftKeys = (role: MatrixRole): string[] => drafts[role.id ?? ''] ?? role.permissions;

  /** A role is dirty when its draft differs from the saved permission set. */
  const isDirty = (role: MatrixRole): boolean => {
    const roleId = role.id;
    if (roleId === null) return false;
    const draft = drafts[roleId];
    if (draft === undefined) return false;
    const draftSet = new Set(draft);
    const savedSet = new Set(role.permissions);
    // Equal sizes + draft ⊆ saved ⇔ equal sets — robust even if drafts ever
    // contained duplicates.
    return draftSet.size !== savedSet.size || [...draftSet].some((k) => !savedSet.has(k));
  };

  const togglePermission = (role: MatrixRole, permission: string) => {
    // Hoist + narrow the id so it stays `string` inside the updater closure.
    const roleId = role.id;
    if (roleId === null) return;
    setDrafts((prev) => {
      const next = new Set(prev[roleId] ?? role.permissions);
      if (hasPermissionKey([...next], permission)) {
        // Effective via the exact key or the area `:manage` key — remove both
        // so the visible state actually flips after save (the checkbox is
        // covered-by-manage hint explains this on the cell itself).
        next.delete(permission);
        next.delete(permission.replace(/:[^:]+$/, '') + ':manage');
      } else {
        next.add(permission);
      }
      return { ...prev, [roleId]: [...next] };
    });
    setMatrixError(null);
  };

  /** Discard the unsaved draft for a role — cells snap back to the saved set. */
  const handleRevert = (role: MatrixRole) => {
    const roleId = role.id;
    if (roleId === null) return;
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[roleId];
      return next;
    });
    setMatrixError(null);
  };

  const handleSavePermissions = async (role: MatrixRole) => {
    const roleId = role.id;
    if (roleId === null || savingRoleId !== null) return;
    setSavingRoleId(roleId);
    setError(null);
    setNotice(null);
    try {
      await updateRole(roleId, { permissionKeys: draftKeys(role) });
      setMatrixNotice('roles.permissionsSaved');
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[roleId];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ['role-matrix'] });
    } catch (err) {
      setMatrixError(roleErrorKey(err)); // keep the draft so the user can retry or revert
    } finally {
      setSavingRoleId(null);
    }
  };

  const handleDeleteRole = async () => {
    if (deleteTarget === null || organizationId === null) return;
    const roleId = deleteTarget.id;
    if (roleId === null) return;
    setIsDeleting(true);
    setMatrixError(null);
    setMatrixNotice(null);
    try {
      await deleteRole(roleId);
      setDeleteTarget(null);
      setMatrixNotice('roles.deleted');
      await queryClient.invalidateQueries({ queryKey: ['role-matrix'] });
    } catch (err) {
      setMatrixError(roleErrorKey(err));
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

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
          <p className="mb-3 text-xs text-muted-foreground">{t('roles.customRolesHint')}</p>
          {matrixError && (
            <p role="alert" className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t(matrixError)}
            </p>
          )}
          {matrixNotice && (
            <p role="status" className="mb-3 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600">
              {t(matrixNotice)}
            </p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b align-bottom">
                <th className="py-2 pe-4 text-start font-medium text-muted-foreground">{t('roles.permission')}</th>
                {allRoles.map((role) => (
                  <th key={role.key} className="px-2 py-2 text-start font-medium">
                    <div className="flex items-center gap-1">
                      <span>{role.name}</span>
                      {role.system && <span className="text-xs text-muted-foreground">({t('roles.system')})</span>}
                      {!role.system && (
                        <button
                          type="button"
                          className="ms-0.5 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => setDeleteTarget(role)}
                          aria-label={t('roles.deleteRole', { name: role.name })}
                          title={t('roles.deleteRole', { name: role.name })}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {!role.system && isDirty(role) && (
                      <div className="mt-2 flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          loading={savingRoleId === role.id}
                          onClick={() => void handleSavePermissions(role)}
                        >
                          {t('common.save')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={savingRoleId === role.id}
                          onClick={() => handleRevert(role)}
                        >
                          {t('roles.revert')}
                        </Button>
                      </div>
                    )}
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
              {permissionCatalog.map((permissionKey) => {
                const reserved = platformPermissions.includes(permissionKey);
                return (
                  <tr key={permissionKey} className="border-b last:border-0">
                    <td className="py-2 pe-4 font-mono text-xs">{permissionKey}</td>
                    {allRoles.map((role) => {
                      const roleKeys = draftKeys(role);
                      const checked = hasPermissionKey(roleKeys, permissionKey);
                      const areaGrant = permissionKey.replace(/:[^:]+$/, '') + ':manage';
                      // The cell is checked via the area `:manage` grant (not
                      // the exact key) — unchecking removes that whole grant.
                      const coveredByArea =
                        checked && !roleKeys.includes(permissionKey) && roleKeys.includes(areaGrant);
                      if (role.system) {
                        return (
                          <td key={role.key} className="px-2 py-2 text-center">
                            <span className={checked ? 'text-emerald-600' : undefined}>{checked ? '✓' : ''}</span>
                          </td>
                        );
                      }
                      if (reserved) {
                        // AUTHZ-4: owner/admin-only permissions are never
                        // grantable to custom roles — show, but locked.
                        return (
                          <td key={role.key} className="px-2 py-2 text-center">
                            <span
                              className="text-muted-foreground/40"
                              title={t('roles.reservedPermissionTitle')}
                              aria-label={t('roles.reservedPermissionTitle')}
                            >
                              —
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td key={role.key} className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePermission(role, permissionKey)}
                            aria-label={t('roles.togglePermission', { permission: permissionKey, role: role.name })}
                            title={coveredByArea ? t('roles.areaGrantHint', { permission: areaGrant }) : undefined}
                            className="size-4 accent-primary"
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('roles.deleteConfirmTitle')}
        description={t('roles.deleteConfirmBody', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        destructive
        loading={isDeleting}
        onConfirm={() => void handleDeleteRole()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
