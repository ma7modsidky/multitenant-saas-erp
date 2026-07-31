'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';


import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { getInvitations, getMembers, getRoles, inviteUser, removeMember, updateMemberRole } from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';

export default function MembersSettingsPage() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const { organizationId } = useSession();

  const { data: members } = useQuery({
    queryKey: ['members', organizationId],
    queryFn: () => {
      if (organizationId === null) throw new Error('No organization selected');
      return getMembers(organizationId);
    },
    enabled: organizationId !== null,
  });
  const { data: invitations } = useQuery({
    queryKey: ['invitations', organizationId],
    queryFn: () => {
      if (organizationId === null) throw new Error('No organization selected');
      return getInvitations(organizationId);
    },
    enabled: organizationId !== null,
  });
  const { data: roles } = useQuery({
    queryKey: ['roles', organizationId],
    queryFn: () => {
      if (organizationId === null) throw new Error('No organization selected');
      return getRoles(organizationId);
    },
    enabled: organizationId !== null,
  });

  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  if (organizationId === null) return null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['members'] });

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleId) {
      setError('members.errors.chooseRole');
      return;
    }
    setIsInviting(true);
    setError(null);
    setNotice(null);
    try {
      await inviteUser(organizationId, { email, roleId });
      setEmail('');
      setNotice('members.inviteSent');
      await queryClient.invalidateQueries({ queryKey: ['invitations'] });
    } catch (err) {
      setError(err instanceof ApiError ? 'members.errors.inviteFailed' : 'auth.errors.unknown');
    } finally {
      setIsInviting(false);
    }
  };

  const handleRemove = async (membershipId: string) => {
    if (!window.confirm(t('members.confirmRemove'))) return;
    setError(null);
    try {
      await removeMember(membershipId);
      await invalidate();
    } catch {
      setError('members.errors.actionFailed');
    }
  };

  const handleRoleChange = async (membershipId: string, nextRoleId: string) => {
    setError(null);
    try {
      await updateMemberRole(membershipId, nextRoleId);
      await invalidate();
    } catch {
      setError('members.errors.actionFailed');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.sections.members')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.descriptions.members')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('members.inviteTitle')}</CardTitle>
          <CardDescription>{t('members.inviteSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleInvite(e)} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="invite-email">{t('auth.email')}</Label>
              <div className="relative">
                <Mail className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  id="invite-email"
                  type="email"
                  className="ps-9"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="space-y-2 sm:w-48">
              <Label htmlFor="invite-role">{t('members.role')}</Label>
              <Select id="invite-role" value={roleId} onValueChange={setRoleId} placeholder={t('members.chooseRole')}>
                {(roles ?? []).map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.nameI18n.en ?? role.key}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <Button type="submit" loading={isInviting}>
              {t('members.invite')}
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
          <CardTitle className="text-base">{t('members.listTitle')}</CardTitle>
          <CardDescription>{t('members.listSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {(members ?? []).map((member) => {
              const currentRole = (roles ?? []).find((r) => r.id === member.roleId);
              return (
                <li key={member.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{member.userId}</p>
                    <p className="text-xs text-muted-foreground">
                      {currentRole?.nameI18n.en ?? member.roleId} · {member.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={member.roleId} onValueChange={(v) => void handleRoleChange(member.id, v)} disabled={currentRole?.isSystem} className="w-40">
                      {(roles ?? []).map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.nameI18n.en ?? role.key}
                        </SelectItem>
                      ))}
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleRemove(member.id)}
                      aria-label={t('members.remove')}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              );
            })}
            {(members ?? []).length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">{t('members.noMembers')}</li>
            )}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('members.invitationsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {(invitations ?? []).map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {inv.status} · {t('members.expires', { date: new Date(inv.expiresAt).toLocaleDateString() })}
                  </p>
                </div>
              </li>
            ))}
            {(invitations ?? []).length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">{t('members.noInvitations')}</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
