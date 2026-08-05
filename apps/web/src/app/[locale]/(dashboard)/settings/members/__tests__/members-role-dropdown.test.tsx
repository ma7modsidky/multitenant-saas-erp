// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above the top-level data, so mock data must
// live in vi.hoisted() to be referenceable from the factories.
const h = vi.hoisted(() => {
  const OWNER_PERMISSIONS: string[] = [
    'platform:members:invite',
    'platform:members:assign-role',
    'platform:members:remove',
  ];
  // 9 members so the first paginated page (PAGE_SIZE = 8) has a next page.
  const MEMBERS = Array.from({ length: 9 }, (_, i) => ({
    id: `m-${i + 1}`,
    userId: `user-${i + 2}`,
    name: i === 0 ? 'Jane' : `Member ${i + 1}`,
    email: i === 0 ? 'jane@example.com' : `member${i + 1}@example.com`,
    roleId: i === 0 ? 'role-member' : i % 2 === 0 ? 'role-admin' : 'role-member',
    status: i === 0 ? 'active' : i % 3 === 0 ? 'invited' : 'active',
    joinedAt: '2026-01-01',
  }));
  const ROLES = [
    {
      id: 'role-owner',
      key: 'owner',
      nameI18n: { en: 'Owner' },
      description: null,
      isSystem: true,
      permissions: [],
      memberCount: 1,
    },
    {
      id: 'role-admin',
      key: 'admin',
      nameI18n: { en: 'Admin' },
      description: null,
      isSystem: true,
      permissions: [],
      memberCount: 4,
    },
    {
      id: 'role-member',
      key: 'member',
      nameI18n: { en: 'Member' },
      description: null,
      isSystem: true,
      permissions: [],
      memberCount: 4,
    },
  ];
  const INVITATIONS = [
    {
      id: 'inv-pending',
      name: 'Newbie Person',
      email: 'newbie@example.com',
      roleId: 'role-member',
      status: 'pending',
      expiresAt: '2030-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'inv-accepted',
      name: 'Already In',
      email: 'already-in@example.com',
      roleId: 'role-admin',
      status: 'accepted',
      expiresAt: '2026-02-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'inv-revoked',
      name: null,
      email: 'revoked@example.com',
      roleId: 'role-member',
      status: 'revoked',
      expiresAt: '2026-02-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  const MY_ORGS = [
    {
      organizationId: 'org-1',
      organizationName: 'Acme Inc',
      organizationSlug: 'acme',
      roleId: 'role-owner',
      status: 'active',
      organizationStatus: 'active',
      joinedAt: '2026-01-01',
      current: true,
    },
  ];
  return { OWNER_PERMISSIONS, MEMBERS, ROLES, INVITATIONS, MY_ORGS };
});

// Session permissions are mutable per-test (owner vs plain member).
let permissions: string[] = h.OWNER_PERMISSIONS;

vi.mock('@/lib/auth/session-context', () => ({
  useSession: () => ({
    status: 'authenticated',
    user: { id: 'user-1', email: 'owner@example.com', name: 'Owner', preferredLocale: 'en', emailVerified: true },
    organizationId: 'org-1',
    permissions,
    login: vi.fn(),
    switchOrg: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}));

const {
  revokeInvitation: revokeInvitationMock,
  removeMember: removeMemberMock,
  updateMemberRole: updateMemberRoleMock,
} = vi.hoisted(() => ({
  revokeInvitation: vi.fn().mockResolvedValue({ message: 'ok' }),
  removeMember: vi.fn().mockResolvedValue({ message: 'ok' }),
  updateMemberRole: vi.fn().mockResolvedValue({ message: 'ok' }),
}));

vi.mock('@/lib/api/resources', () => ({
  getMembers: vi.fn().mockResolvedValue(h.MEMBERS),
  getInvitations: vi.fn().mockResolvedValue(h.INVITATIONS),
  getRoles: vi.fn().mockResolvedValue(h.ROLES),
  getMyOrganizations: vi.fn().mockResolvedValue(h.MY_ORGS),
  inviteUser: vi.fn(),
  removeMember: removeMemberMock,
  updateMemberRole: updateMemberRoleMock,
  revokeInvitation: revokeInvitationMock,
}));

vi.mock('@/lib/permissions', () => ({
  hasPermission: (granted: readonly string[], required: string) => granted.includes(required),
}));

// Mock the query layer directly: the members page destructures `data` from
// each useQuery call keyed by queryKey[0] — hand back the hoisted fixtures.
const { invalidateMock } = vi.hoisted(() => ({
  invalidateMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    switch (queryKey[0]) {
      case 'members':
        return { data: h.MEMBERS };
      case 'invitations':
        return { data: h.INVITATIONS };
      case 'roles':
        return { data: h.ROLES };
      case 'my-organizations':
        return { data: h.MY_ORGS };
      default:
        return { data: undefined };
    }
  },
  useQueryClient: () => ({ invalidateQueries: invalidateMock }),
}));

import MembersSettingsPage from '../page';

function renderPage() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <MembersSettingsPage />
    </NextIntlClientProvider>,
  );
}

describe('MembersSettingsPage — role-change dropdown gating (AUTHZ-5)', () => {
  beforeEach(() => {
    permissions = h.OWNER_PERMISSIONS;
    revokeInvitationMock.mockClear();
    removeMemberMock.mockClear();
    updateMemberRoleMock.mockClear();
    invalidateMock.mockClear();
  });

  it('AUTHZ-5: an OWNER with the assign-role permission sees the role-change dropdown for each member', async () => {
    permissions = h.OWNER_PERMISSIONS;

    renderPage();

    await waitFor(() => expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument());

    // The per-member role select must be present (canAssignRole is true) — the
    // reported regression: it was missing because the org-less token carried no
    // permissions. With restored claims the owner gets the control back.
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(2); // invite-role select + member role select
  });

  it('AUTHZ-5/AUTHZ-2: a plain MEMBER (data perms only) is shown the AccessDenied gate instead of the page', async () => {
    permissions = ['platform:data:read', 'platform:data:write'];

    renderPage();

    await waitFor(() => expect(screen.getByText('Access denied')).toBeInTheDocument());
    expect(screen.queryByText(/jane@example\.com/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  });
});

describe('MembersSettingsPage — pagination + filters', () => {
  beforeEach(() => {
    permissions = h.OWNER_PERMISSIONS;
  });

  it('paginates the member list (PAGE_SIZE = 8) and pages forward/back', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument());

    // First page: first 8 members visible, the 9th is not.
    expect(screen.getByText(/member8@example\.com/)).toBeInTheDocument();
    expect(screen.queryByText(/member9@example\.com/)).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1–8 of 9')).toBeInTheDocument();

    // Both the members and invitations cards render their own pagination, so
    // the members card (rendered first) is the first 'Next'/'Previous' button.
    await user.click(screen.getAllByRole('button', { name: 'Next' })[0]!);

    expect(screen.getByText(/member9@example\.com/)).toBeInTheDocument();
    expect(screen.queryByText(/jane@example\.com/)).not.toBeInTheDocument();
    expect(screen.getByText('Showing 9–9 of 9')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Previous' })[0]!);
    expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument();
  });

  it('filters members by search text', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument());

    const search = screen.getByRole('textbox', { name: 'Search members…' });
    await user.type(search, 'member3');

    expect(screen.getByText(/member3@example\.com/)).toBeInTheDocument();
    expect(screen.queryByText(/jane@example\.com/)).not.toBeInTheDocument();
  });

  it('filters members by role', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument());

    // Role filter select (the first "All roles" select on the members card).
    const roleFilter = screen.getAllByRole('combobox').find((el) => el.getAttribute('aria-label') === 'All roles');
    expect(roleFilter).toBeDefined();
    // Custom Select: click the trigger, then the option in the popover list.
    await user.click(roleFilter!);
    await user.click(await screen.findByRole('option', { name: 'Admin' }));

    // Every visible member now has the Admin badge; Jane (Member) is filtered out.
    expect(screen.queryByText(/jane@example\.com/)).not.toBeInTheDocument();
    const adminBadges = await screen.findAllByText('Admin');
    expect(adminBadges.length).toBeGreaterThan(0);
  });

  it('filters invitations by status and shows the invited role', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('newbie@example.com')).toBeInTheDocument());

    // The accepted invitation shows its invited role (Admin badge).
    const acceptedRow = screen.getByText('already-in@example.com').closest('li')!;
    expect(within(acceptedRow).getByText('Admin')).toBeInTheDocument();

    // Both cards render an 'All statuses' filter — the invitations card is
    // rendered second, so its filter is the LAST matching combobox.
    const statusFilters = screen
      .getAllByRole('combobox')
      .filter((el) => el.getAttribute('aria-label') === 'All statuses');
    expect(statusFilters.length).toBeGreaterThanOrEqual(2);
    const invStatusFilter = statusFilters.at(-1)!;
    await user.click(invStatusFilter);
    await user.click(await screen.findByRole('option', { name: 'Pending' }));

    expect(screen.getByText('newbie@example.com')).toBeInTheDocument();
    expect(screen.queryByText('already-in@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('revoked@example.com')).not.toBeInTheDocument();
  });
});

describe('MembersSettingsPage — role + status badges', () => {
  beforeEach(() => {
    permissions = h.OWNER_PERMISSIONS;
  });

  it('renders a colored role badge and a member-status badge per member', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument());

    const janeRow = screen.getByText(/jane@example\.com/).closest('li')!;
    // selector 'span.rounded-md' disambiguates the badge from the role select
    // trigger's label (both render 'Member'); the Badge is a <span>.
    expect(within(janeRow).getByText('Member', { selector: 'span.rounded-md' })).toBeInTheDocument(); // role badge
    expect(within(janeRow).getByText('Active', { selector: 'span.rounded-md' })).toBeInTheDocument(); // status badge
  });
});

describe('MembersSettingsPage — invitation name (migration 0012)', () => {
  beforeEach(() => {
    permissions = h.OWNER_PERMISSIONS;
    invalidateMock.mockClear();
  });

  it('AUTH-9/AUTHZ-8: the invite form collects the invitee name next to the email', async () => {
    const user = userEvent.setup();
    const { inviteUser: inviteUserMock } = await import('@/lib/api/resources');
    vi.mocked(inviteUserMock).mockResolvedValue({ invitationId: 'inv-new' });

    renderPage();

    await waitFor(() => expect(screen.getByLabelText('Full name')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Full name'), 'Jane Cooper');
    await user.type(screen.getByLabelText('Email address'), 'jane.cooper@example.com');
    // Scope the role select to the invite form: the per-member role selects
    // share the same 'Role' accessible name (aria-label), so an unqualified
    // getByLabelText('Role') would match multiple elements.
    const inviteForm = screen.getByLabelText('Full name').closest('form')!;
    await user.click(within(inviteForm).getByLabelText('Role'));
    await user.click(within(inviteForm).getByRole('option', { name: 'Member' }));
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(inviteUserMock).toHaveBeenCalledWith('org-1', {
      name: 'Jane Cooper',
      email: 'jane.cooper@example.com',
      roleId: 'role-member',
    });
  });

  it('invitations list shows the invitee name and falls back to the email for legacy invites', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('Newbie Person')).toBeInTheDocument());
    // Named invitation: name is primary, email secondary.
    expect(screen.getByText('newbie@example.com')).toBeInTheDocument();
    // Legacy invitation (name: null, pre-0012): email is the primary line.
    expect(screen.getByText('revoked@example.com')).toBeInTheDocument();
  });

  it('copying an invite link carries the display metadata (name, org, role) for the public invite page', async () => {
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
    window.history.replaceState({}, '', '/en/settings/members');

    renderPage();

    await waitFor(() => expect(screen.getByText('Newbie Person')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Copy invite link' }));

    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1));
    const url = String(clipboard.mock.calls[0]![0]);
    // URLSearchParams encodes spaces as '+' (not '%20'), so parse the link
    // instead of string-matching the raw encoding.
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/en/invitations/inv-pending');
    expect(parsed.searchParams.get('email')).toBe('newbie@example.com');
    expect(parsed.searchParams.get('name')).toBe('Newbie Person');
    expect(parsed.searchParams.get('org')).toBe('Acme Inc');
    expect(parsed.searchParams.get('role')).toBe('Member');
  });
});

describe('MembersSettingsPage — invitation manager (pending / accepted / revoked)', () => {
  beforeEach(() => {
    permissions = h.OWNER_PERMISSIONS;
    revokeInvitationMock.mockClear();
    invalidateMock.mockClear();
  });

  it('renders a status badge per invitation', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('newbie@example.com')).toBeInTheDocument());

    // selector 'span' disambiguates the badges from the status-filter
    // <select>'s <option> text (Pending/Accepted/Revoked appear in both).
    expect(screen.getByText('Pending', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Accepted', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Revoked', { selector: 'span' })).toBeInTheDocument();
  });

  it('shows copy-link and revoke actions only for pending invitations', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('newbie@example.com')).toBeInTheDocument());

    const pendingRow = screen.getByText('newbie@example.com').closest('li')!;
    expect(within(pendingRow).getByRole('button', { name: 'Copy invite link' })).toBeInTheDocument();
    expect(within(pendingRow).getByRole('button', { name: 'Revoke' })).toBeInTheDocument();

    const acceptedRow = screen.getByText('already-in@example.com').closest('li')!;
    expect(within(acceptedRow).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();

    const revokedRow = screen.getByText('revoked@example.com').closest('li')!;
    expect(within(revokedRow).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('revokes a pending invitation through the confirm dialog: confirms, calls the API, invalidates', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('newbie@example.com')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    // The confirm dialog appears; nothing is called until confirmed.
    expect(revokeInvitationMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(revokeInvitationMock).toHaveBeenCalledTimes(1);
    expect(revokeInvitationMock).toHaveBeenCalledWith('org-1', 'inv-pending');

    await waitFor(() => expect(screen.getByText('Invitation revoked.')).toBeInTheDocument());
    expect(invalidateMock).toHaveBeenCalledWith({ queryKey: ['invitations'] });
  });

  it('aborts the revoke when the dialog is cancelled', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('newbie@example.com')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(revokeInvitationMock).not.toHaveBeenCalled();
  });

  it('keeps revoke visible for an invite-permission role (backend parity: revoke route requires platform:members:invite)', async () => {
    permissions = ['platform:members:invite'];

    renderPage();

    await waitFor(() => expect(screen.getByText('newbie@example.com')).toBeInTheDocument());

    const pendingRow = screen.getByText('newbie@example.com').closest('li')!;
    expect(within(pendingRow).getByRole('button', { name: 'Copy invite link' })).toBeInTheDocument();
    expect(within(pendingRow).getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });

  it('surfaces a specific error when the invitation was already accepted (AUTH-9)', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api');
    revokeInvitationMock.mockRejectedValueOnce(new ApiError(409, { code: 'INVITATION_ALREADY_ACCEPTED' }));

    renderPage();

    await waitFor(() => expect(screen.getByText('newbie@example.com')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByText('This invitation has already been accepted.')).toBeInTheDocument());
  });
});

describe('MembersSettingsPage — remove member + role change confirm dialogs', () => {
  beforeEach(() => {
    permissions = h.OWNER_PERMISSIONS;
    removeMemberMock.mockClear();
    updateMemberRoleMock.mockClear();
    invalidateMock.mockClear();
  });

  it('removes a member only after confirming in the dialog', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument());

    const janeRow = screen.getByText(/jane@example\.com/).closest('li')!;
    await user.click(within(janeRow).getByRole('button', { name: 'Remove member' }));

    expect(removeMemberMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(removeMemberMock).toHaveBeenCalledTimes(1);
    expect(removeMemberMock).toHaveBeenCalledWith('m-1');
    await waitFor(() => expect(invalidateMock).toHaveBeenCalledWith({ queryKey: ['members'] }));
  });

  it('changes a member role only after confirming in the dialog', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument());

    const janeRow = screen.getByText(/jane@example\.com/).closest('li')!;
    const roleSelect = within(janeRow).getAllByRole('combobox').at(-1)!;
    await user.click(roleSelect);
    await user.click(await screen.findByRole('option', { name: 'Admin' }));

    // The dialog describes the pending change; the API is not called yet.
    expect(updateMemberRoleMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Change the role of Jane to Admin/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(updateMemberRoleMock).toHaveBeenCalledTimes(1);
    expect(updateMemberRoleMock).toHaveBeenCalledWith('m-1', 'role-admin');
    await waitFor(() => expect(invalidateMock).toHaveBeenCalledWith({ queryKey: ['members'] }));
  });

  it('cancelling the role dialog does not change the role', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument());

    const janeRow = screen.getByText(/jane@example\.com/).closest('li')!;
    const roleSelect = within(janeRow).getAllByRole('combobox').at(-1)!;
    await user.click(roleSelect);
    await user.click(await screen.findByRole('option', { name: 'Admin' }));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(updateMemberRoleMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
