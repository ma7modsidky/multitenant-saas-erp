'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Mail, Search, Trash2, User, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { AccessDenied } from '@/components/shell/access-denied';
import { NoOrganizationState } from '@/components/shell/no-organization-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import {
  inviteErrorKey,
  removeMemberErrorKey,
  revokeInvitationErrorKey,
  updateRoleErrorKey,
} from '@/lib/api/error-keys';
import {
  getInvitations,
  getMembers,
  getMyOrganizations,
  getRoles,
  inviteUser,
  removeMember,
  revokeInvitation,
  updateMemberRole,
} from '@/lib/api/resources';
import type { InvitationResponse, MemberResponse, RoleResponse } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session-context';
import { hasPermission } from '@/lib/permissions';

const PAGE_SIZE = 8;

// ─── Badge color maps ──────────────────────────────────────────────────────
// System roles get a distinct color; custom roles fall back to a neutral tone.
const ROLE_BADGE_COLORS: Record<string, string> = {
  owner: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  admin: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30',
  manager: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
  member: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30',
  viewer: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
};
const NEUTRAL_BADGE_COLOR = 'bg-secondary text-secondary-foreground border-transparent';

const MEMBER_STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  invited: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  disabled: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30',
};

const INVITATION_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  accepted: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  revoked: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30',
};

// Iterated to render the filter dropdowns — a readonly array type avoids an
// `as const` cast (base no-restricted-syntax bans TSAsExpression).
const MEMBER_STATUSES: readonly string[] = ['active', 'invited', 'disabled'];
const INVITATION_STATUSES: readonly string[] = ['pending', 'accepted', 'revoked'];

function roleDisplayName(role: RoleResponse | undefined, locale: string): string {
  if (!role) return '';
  return role.nameI18n[locale] ?? role.nameI18n.en ?? role.key;
}

function PaginationControls({
  page,
  pageCount,
  from,
  to,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const t = useTranslations();
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
      <p className="text-xs text-muted-foreground">
        {t('members.showingCount', { from: String(from), to: String(to), total: String(total) })}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onPrev} disabled={page <= 0} aria-label={t('common.previous')}>
          {t('common.previous')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t('members.pageOf', { page: String(page + 1), pages: String(pageCount) })}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={page >= pageCount - 1}
          aria-label={t('common.next')}
        >
          {t('common.next')}
        </Button>
      </div>
    </div>
  );
}

export default function MembersSettingsPage() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const { organizationId, user, permissions } = useSession();

  // AUTHZ-5/BUSINESS_RULES §3: only OWNER/ADMIN manage members. The backend
  // enforces this via @RequiresPermission; the UI hides the controls for
  // members (server-authoritative — this is UX only).
  const canInvite = hasPermission(permissions, 'platform:members:invite');
  const canAssignRole = hasPermission(permissions, 'platform:members:assign-role');
  const canRemove = hasPermission(permissions, 'platform:members:remove');

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
  // Org name rides in the copied invite link so the invite page can greet the
  // invitee with the org they are joining (display-only; the accept flow is
  // still server-authoritative). Same query key as the Topbar, so the result
  // is shared from the react-query cache (no duplicate fetch).
  const { data: myOrgs } = useQuery({
    queryKey: ['my-organizations'],
    queryFn: getMyOrganizations,
    enabled: organizationId !== null,
  });

  const orgName = myOrgs?.find((o) => o.organizationId === organizationId)?.organizationName ?? '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ─── Member list filters + pagination ───────────────────────────────────
  const [memberSearch, setMemberSearch] = useState('');
  const [memberRoleFilter, setMemberRoleFilter] = useState('');
  const [memberStatusFilter, setMemberStatusFilter] = useState('');
  const [memberPage, setMemberPage] = useState(0);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return (members ?? []).filter((m) => {
      if (memberRoleFilter !== '' && m.roleId !== memberRoleFilter) return false;
      if (memberStatusFilter !== '' && m.status !== memberStatusFilter) return false;
      if (q !== '' && !`${m.name} ${m.email}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [members, memberSearch, memberRoleFilter, memberStatusFilter]);

  const memberPageCount = Math.max(1, Math.ceil(filteredMembers.length / PAGE_SIZE));
  const safeMemberPage = Math.min(memberPage, memberPageCount - 1);
  const pageMembers = filteredMembers.slice(safeMemberPage * PAGE_SIZE, safeMemberPage * PAGE_SIZE + PAGE_SIZE);

  // ─── Invitation list filters + pagination ───────────────────────────────
  const [invSearch, setInvSearch] = useState('');
  const [invStatusFilter, setInvStatusFilter] = useState('');
  const [invPage, setInvPage] = useState(0);

  const filteredInvitations = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    return (invitations ?? []).filter((inv) => {
      if (invStatusFilter !== '' && inv.status !== invStatusFilter) return false;
      if (q !== '' && !`${inv.name ?? ''} ${inv.email}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [invitations, invSearch, invStatusFilter]);

  const invPageCount = Math.max(1, Math.ceil(filteredInvitations.length / PAGE_SIZE));
  const safeInvPage = Math.min(invPage, invPageCount - 1);
  const pageInvitations = filteredInvitations.slice(safeInvPage * PAGE_SIZE, safeInvPage * PAGE_SIZE + PAGE_SIZE);

  // ─── Confirm dialog targets ─────────────────────────────────────────────
  const [removeTarget, setRemoveTarget] = useState<MemberResponse | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<InvitationResponse | null>(null);
  const [roleTarget, setRoleTarget] = useState<{
    membershipId: string;
    nextRoleId: string;
    memberName: string;
    nextRoleName: string;
  } | null>(null);
  // Which destructive/confirm action is currently in flight — drives the
  // ConfirmDialog `loading` state so the dialog's buttons (and Escape/backdrop)
  // lock during the async call, preventing double-submission.
  const [pendingAction, setPendingAction] = useState<'remove' | 'revoke' | 'role' | null>(null);

  const copyInviteLink = async (
    invitationId: string,
    emailAddress: string,
    inviteeName: string | null,
    roleName: string,
  ) => {
    // Display info rides in the URL so the PUBLIC invite page can greet the
    // invitee before they authenticate: email (bound to the invitation per
    // AUTH-3/AUTH-9, used to pre-fill and lock the signup form), plus the
    // invitee name, org name, and role display name (display-only — the
    // accept flow is server-authoritative via the user_own_invitations RLS
    // policy 0009, so a forged display param can never change the role).
    const params = new URLSearchParams({ email: emailAddress });
    if (inviteeName) params.set('name', inviteeName);
    if (orgName) params.set('org', orgName);
    if (roleName) params.set('role', roleName);
    const url = `${window.location.origin}/${locale}/invitations/${invitationId}?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(invitationId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError('members.errors.actionFailed');
    }
  };

  if (organizationId === null) return <NoOrganizationState />;

  // AUTHZ-2/UX: this page is OWNER/ADMIN-only. The backend enforces every
  // action via @RequiresPermission (OPS-8 — server-authoritative); this gate
  // covers direct-URL navigation by members (the sidebar/hub already hide it).
  if (!canInvite) return <AccessDenied />;

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
      await inviteUser(organizationId, { name, email, roleId });
      setName('');
      setEmail('');
      setNotice('members.inviteSent');
      await queryClient.invalidateQueries({ queryKey: ['invitations'] });
    } catch (err) {
      // AUTHZ-8: the API rejects duplicate members and duplicate pending
      // invitations with 409 — surface the specific reason instead of a
      // generic failure message.
      setError(inviteErrorKey(err));
    } finally {
      setIsInviting(false);
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget || pendingAction !== null) return;
    setPendingAction('remove');
    setError(null);
    try {
      await removeMember(removeTarget.id);
      await invalidate();
    } catch (err) {
      // AUTHZ-1/AUTHZ-2: the last OWNER cannot be removed, and only an OWNER
      // can remove an OWNER — surface the specific reason.
      setError(removeMemberErrorKey(err));
    } finally {
      setPendingAction(null);
      setRemoveTarget(null);
    }
  };

  const confirmRevoke = async () => {
    if (!revokeTarget || pendingAction !== null) return;
    setPendingAction('revoke');
    setError(null);
    setNotice(null);
    try {
      await revokeInvitation(organizationId, revokeTarget.id);
      setNotice('members.invitationRevoked');
      await queryClient.invalidateQueries({ queryKey: ['invitations'] });
    } catch (err) {
      // AUTH-9: only pending invitations can be revoked.
      setError(revokeInvitationErrorKey(err));
    } finally {
      setPendingAction(null);
      setRevokeTarget(null);
    }
  };

  const confirmRoleChange = async () => {
    if (!roleTarget || pendingAction !== null) return;
    setPendingAction('role');
    setError(null);
    try {
      await updateMemberRole(roleTarget.membershipId, roleTarget.nextRoleId);
      await invalidate();
    } catch (err) {
      // AUTHZ-1 / AUTHZ-3: last owner cannot be demoted, own role cannot change.
      setError(updateRoleErrorKey(err));
    } finally {
      setPendingAction(null);
      setRoleTarget(null);
    }
  };

  const openRoleDialog = (member: MemberResponse, nextRoleId: string) => {
    if (nextRoleId === member.roleId) return;
    const nextRole = (roles ?? []).find((r) => r.id === nextRoleId);
    setRoleTarget({
      membershipId: member.id,
      nextRoleId,
      memberName: member.name || member.email,
      nextRoleName: roleDisplayName(nextRole, locale),
    });
  };

  const cancelLabel = t('common.cancel');
  const confirmLabel = t('common.confirm');

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.sections.members')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.descriptions.members')}</p>
      </div>

      {/* Page-level status area: invite failures, member remove/role-change
          errors, and revoke outcomes all surface here — NOT inside the invite
          card, which would misplace list-action feedback (the original bug the
          earlier manual testing hit: the error banner only lived in the
          invite form). */}
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

      {canInvite && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('members.inviteTitle')}</CardTitle>
            <CardDescription>{t('members.inviteSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void handleInvite(e)} className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="invite-name">{t('members.inviteeName')}</Label>
                <div className="relative">
                  <User className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    id="invite-name"
                    type="text"
                    className="ps-9"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('members.inviteeNamePlaceholder')}
                    required
                    maxLength={120}
                    autoComplete="off"
                  />
                </div>
              </div>
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
                      {roleDisplayName(role, locale)}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <Button type="submit" loading={isInviting}>
                {t('members.invite')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('members.listTitle')}</CardTitle>
          <CardDescription>{t('members.listSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                className="ps-9"
                placeholder={t('members.searchMembers')}
                value={memberSearch}
                onChange={(e) => {
                  setMemberSearch(e.target.value);
                  setMemberPage(0);
                }}
                aria-label={t('members.searchMembers')}
              />
            </div>
            <Select
              value={memberRoleFilter}
              onValueChange={(v) => {
                setMemberRoleFilter(v);
                setMemberPage(0);
              }}
              placeholder={t('members.allRoles')}
              className="sm:w-44"
              aria-label={t('members.allRoles')}
            >
              <SelectItem value="">{t('members.allRoles')}</SelectItem>
              {(roles ?? []).map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {roleDisplayName(role, locale)}
                </SelectItem>
              ))}
            </Select>
            <Select
              value={memberStatusFilter}
              onValueChange={(v) => {
                setMemberStatusFilter(v);
                setMemberPage(0);
              }}
              placeholder={t('members.allStatuses')}
              className="sm:w-40"
              aria-label={t('members.allStatuses')}
            >
              <SelectItem value="">{t('members.allStatuses')}</SelectItem>
              {MEMBER_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`members.memberStatus.${status}`)}
                </SelectItem>
              ))}
            </Select>
          </div>

          <ul className="divide-y">
            {pageMembers.map((member) => {
              const currentRole = (roles ?? []).find((r) => r.id === member.roleId);
              return (
                <li key={member.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{member.name || member.email}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {currentRole && (
                        <Badge variant="outline" className={ROLE_BADGE_COLORS[currentRole.key] ?? NEUTRAL_BADGE_COLOR}>
                          {roleDisplayName(currentRole, locale)}
                        </Badge>
                      )}
                      <Badge variant="outline" className={MEMBER_STATUS_COLORS[member.status] ?? NEUTRAL_BADGE_COLOR}>
                        {t(`members.memberStatus.${member.status}`)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canAssignRole && (
                      <Select
                        value={member.roleId}
                        onValueChange={(v) => openRoleDialog(member, v)}
                        // AUTHZ-3: you cannot change your own role. Everyone else
                        // (including system-role members) is changeable — the
                        // backend enforces AUTHZ-1 (last owner cannot be demoted).
                        disabled={member.userId === user?.id}
                        className="w-40"
                        aria-label={t('members.role')}
                      >
                        {(roles ?? []).map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {roleDisplayName(role, locale)}
                          </SelectItem>
                        ))}
                      </Select>
                    )}
                    {canRemove && member.userId !== user?.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setRemoveTarget(member)}
                        aria-label={t('members.remove')}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
            {filteredMembers.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">{t('members.noMembers')}</li>
            )}
          </ul>

          <PaginationControls
            page={safeMemberPage}
            pageCount={memberPageCount}
            from={filteredMembers.length === 0 ? 0 : safeMemberPage * PAGE_SIZE + 1}
            to={Math.min((safeMemberPage + 1) * PAGE_SIZE, filteredMembers.length)}
            total={filteredMembers.length}
            onPrev={() => setMemberPage(Math.max(0, safeMemberPage - 1))}
            onNext={() => setMemberPage(Math.min(memberPageCount - 1, safeMemberPage + 1))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('members.invitationsTitle')}</CardTitle>
          <CardDescription>{t('members.invitationsSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                className="ps-9"
                placeholder={t('members.searchInvitations')}
                value={invSearch}
                onChange={(e) => {
                  setInvSearch(e.target.value);
                  setInvPage(0);
                }}
                aria-label={t('members.searchInvitations')}
              />
            </div>
            <Select
              value={invStatusFilter}
              onValueChange={(v) => {
                setInvStatusFilter(v);
                setInvPage(0);
              }}
              placeholder={t('members.allStatuses')}
              className="sm:w-40"
              aria-label={t('members.allStatuses')}
            >
              <SelectItem value="">{t('members.allStatuses')}</SelectItem>
              {INVITATION_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`members.invitationStatus.${status}`)}
                </SelectItem>
              ))}
            </Select>
          </div>

          <ul className="divide-y">
            {pageInvitations.map((inv) => {
              const invRole = (roles ?? []).find((r) => r.id === inv.roleId);
              return (
                <li key={inv.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{inv.name || inv.email}</p>
                    {inv.name && <p className="text-xs text-muted-foreground">{inv.email}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {invRole && (
                        <Badge variant="outline" className={ROLE_BADGE_COLORS[invRole.key] ?? NEUTRAL_BADGE_COLOR}>
                          {roleDisplayName(invRole, locale)}
                        </Badge>
                      )}
                      <Badge variant="outline" className={INVITATION_STATUS_COLORS[inv.status] ?? NEUTRAL_BADGE_COLOR}>
                        {t(`members.invitationStatus.${inv.status}`)}
                      </Badge>
                      {inv.status === 'pending' && (
                        <span className="text-xs text-muted-foreground">
                          {t('members.expires', { date: new Date(inv.expiresAt).toLocaleDateString() })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {inv.status === 'pending' && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5"
                          onClick={() =>
                            void copyInviteLink(
                              inv.id,
                              inv.email,
                              inv.name,
                              invRole ? roleDisplayName(invRole, locale) : '',
                            )
                          }
                          aria-label={t('members.copyInviteLink')}
                        >
                          <Copy className="size-3.5" />
                          {copiedId === inv.id ? t('members.linkCopied') : t('members.copyInviteLink')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setRevokeTarget(inv)}
                          aria-label={t('members.revokeInvitation')}
                        >
                          <XCircle className="size-3.5" />
                          {t('members.revokeInvitation')}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
            {filteredInvitations.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">{t('members.noInvitations')}</li>
            )}
          </ul>

          <PaginationControls
            page={safeInvPage}
            pageCount={invPageCount}
            from={filteredInvitations.length === 0 ? 0 : safeInvPage * PAGE_SIZE + 1}
            to={Math.min((safeInvPage + 1) * PAGE_SIZE, filteredInvitations.length)}
            total={filteredInvitations.length}
            onPrev={() => setInvPage(Math.max(0, safeInvPage - 1))}
            onNext={() => setInvPage(Math.min(invPageCount - 1, safeInvPage + 1))}
          />
        </CardContent>
      </Card>

      {/* ─── Confirm dialogs ─────────────────────────────────────────────── */}
      <ConfirmDialog
        open={removeTarget !== null}
        title={t('members.confirmRemoveTitle')}
        description={
          removeTarget ? t('members.confirmRemoveBody', { name: removeTarget.name || removeTarget.email }) : undefined
        }
        confirmLabel={t('common.delete')}
        cancelLabel={cancelLabel}
        closeLabel={t('common.close')}
        destructive
        loading={pendingAction === 'remove'}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoveTarget(null)}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        title={t('members.confirmRevokeTitle')}
        description={revokeTarget ? t('members.confirmRevokeBody', { email: revokeTarget.email }) : undefined}
        confirmLabel={t('common.delete')}
        cancelLabel={cancelLabel}
        closeLabel={t('common.close')}
        destructive
        loading={pendingAction === 'revoke'}
        onConfirm={() => void confirmRevoke()}
        onCancel={() => setRevokeTarget(null)}
      />

      <ConfirmDialog
        open={roleTarget !== null}
        title={t('members.confirmRoleTitle')}
        description={
          roleTarget
            ? t('members.confirmRoleBody', { name: roleTarget.memberName, role: roleTarget.nextRoleName })
            : undefined
        }
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        closeLabel={t('common.close')}
        loading={pendingAction === 'role'}
        onConfirm={() => void confirmRoleChange()}
        onCancel={() => setRoleTarget(null)}
      />
    </div>
  );
}
