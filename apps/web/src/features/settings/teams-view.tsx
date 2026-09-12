'use client';

// TeamsView — /settings/teams: table of teams (name, leader, member count,
// actions) with a create/edit dialog. Gated by `platform:teams:manage`
// (OWNER/ADMIN); reads are available to all members for pickers.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { AccessDenied } from '@/components/shell/access-denied';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { useSession } from '@/lib/auth/session-context';
import { hasPermission } from '@/lib/permissions';
import { createTeam, deleteTeam, getMembers, getTeams, updateTeam, type TeamResponse } from '@/lib/api/resources';

interface TeamFormState {
  id: string | null;
  name: string;
  description: string;
  leaderUserId: string;
  memberUserIds: string[];
}

const EMPTY_FORM: TeamFormState = { id: null, name: '', description: '', leaderUserId: '', memberUserIds: [] };

export function TeamsView() {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const { organizationId, permissions } = useSession();
  const queryClient = useQueryClient();
  const canManage = hasPermission(permissions ?? [], 'platform:teams:manage');

  const teams = useQuery({
    queryKey: ['teams', organizationId],
    queryFn: () => (organizationId ? getTeams(organizationId) : Promise.resolve([])),
    enabled: !!organizationId,
  });
  const members = useQuery({
    queryKey: ['members', organizationId],
    queryFn: () => (organizationId ? getMembers(organizationId) : Promise.resolve([])),
    enabled: !!organizationId,
  });

  const [form, setForm] = useState<TeamFormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeamResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['teams', organizationId] });

  const saveMutation = useMutation({
    mutationFn: (state: TeamFormState) => {
      const payload = {
        name: state.name,
        description: state.description || null,
        leaderUserId: state.leaderUserId || null,
        memberUserIds: state.memberUserIds,
      };
      if (!organizationId) return Promise.reject(new Error('organizationId missing'));
      return state.id ? updateTeam(organizationId, state.id, payload) : createTeam(organizationId, payload);
    },
    onSuccess: () => {
      setForm(null);
      setError(null);
      invalidate();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (teamId: string) => {
      if (!organizationId) return Promise.reject(new Error('organizationId missing'));
      return deleteTeam(organizationId, teamId);
    },
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
    },
  });

  if (!canManage) return <AccessDenied />;

  const activeMembers = (members.data ?? []).filter((m) => m.status === 'active');
  const memberName = (userId: string | null | undefined) =>
    activeMembers.find((m) => m.userId === userId)?.name ?? userId ?? '—';

  const toggleMember = (userId: string) =>
    setForm((prev) =>
      prev
        ? {
            ...prev,
            memberUserIds: prev.memberUserIds.includes(userId)
              ? prev.memberUserIds.filter((id) => id !== userId)
              : [...prev.memberUserIds, userId],
          }
        : prev,
    );

  const openEdit = (team: TeamResponse) =>
    setForm({
      id: team.id,
      name: team.name,
      description: team.description ?? '',
      leaderUserId: team.leaderUserId ?? '',
      memberUserIds: [...team.memberUserIds],
    });

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-primary p-2 text-primary-foreground">
            <Users className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('teamsUI.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('teamsUI.subtitle')}</p>
          </div>
        </div>
        <Button onClick={() => setForm({ ...EMPTY_FORM })}>
          <Plus />
          {t('teamsUI.create')}
        </Button>
      </header>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('teamsUI.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {(teams.data ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">—</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-3 py-2.5 text-start font-medium">
                      {t('contacts.tableName')}
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-start font-medium">
                      {t('teamsUI.leader')}
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-start font-medium">
                      {t('teamsUI.members')}
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-start font-medium">
                      {t('teamsUI.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(teams.data ?? []).map((team) => (
                    <tr key={team.id} className="border-b transition-colors last:border-0 hover:bg-accent/40">
                      <td className="px-3 py-2.5 font-medium" dir="auto">
                        {team.name}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{memberName(team.leaderUserId)}</td>
                      <td className="px-3 py-2.5">
                        <Badge variant="secondary">{team.memberCount}</Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEdit(team)}>
                            {t('teamsUI.edit')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(team)}>
                            {t('teamsUI.delete')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-black/50"
            onClick={() => setForm(null)}
          />
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-card p-5 shadow-lg animate-fade-in">
            <h2 className="mb-4 text-base font-semibold">{form.id ? t('teamsUI.edit') : t('teamsUI.create')}</h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="team-name">{t('teamsUI.name')}</Label>
                <Input
                  id="team-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  dir="auto"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-description">{t('teamsUI.description')}</Label>
                <Input
                  id="team-description"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  dir="auto"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('teamsUI.leader')}</Label>
                <Select
                  value={form.leaderUserId}
                  onValueChange={(leaderUserId) =>
                    setForm((prev) => {
                      const next = prev ? { ...prev, leaderUserId } : prev;
                      return next && !next.memberUserIds.includes(leaderUserId)
                        ? { ...next, memberUserIds: [...next.memberUserIds, leaderUserId] }
                        : next;
                    })
                  }
                >
                  <SelectItem value="">{t('teamsUI.noLeader')}</SelectItem>
                  {activeMembers.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name || m.email}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  {t('teamsUI.members')} ({form.memberUserIds.length})
                </Label>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {activeMembers.map((m) => (
                    <label
                      key={m.userId}
                      className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent/40"
                    >
                      <input
                        type="checkbox"
                        checked={form.memberUserIds.includes(m.userId)}
                        onChange={() => toggleMember(m.userId)}
                        className="size-4 accent-primary"
                      />
                      <span className="truncate">{m.name || m.email}</span>
                    </label>
                  ))}
                </div>
              </div>
              {saveMutation.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {t('errors.unknown')}
                </p>
              )}
              <div className="flex justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={() => setForm(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  loading={saveMutation.isPending}
                  disabled={!form.name.trim()}
                  onClick={() => void saveMutation.mutateAsync(form)}
                >
                  {form.id ? t('detail.save') : t('teamsUI.create')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('teamsUI.deleteTitle')}
        description={t('teamsUI.deleteBody')}
        confirmLabel={t('teamsUI.delete')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && void deleteMutation.mutateAsync(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
      {/* locale kept for future date formatting parity */}
      <span className="hidden">{locale}</span>
    </div>
  );
}
