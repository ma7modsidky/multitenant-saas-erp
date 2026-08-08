// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above the top-level data, so mock data must
// live in vi.hoisted() to be referenceable from the factories.
const h = vi.hoisted(() => {
  const OWNER_PERMISSIONS: string[] = ['platform:audit:view', 'platform:data:read'];
  const ENTRIES = [
    {
      id: 'log-1',
      actorUserId: 'user-1',
      actorType: 'user',
      action: 'UPDATE',
      entityType: 'membership',
      entityId: 'mem-1',
      before: null,
      after: { roleId: 'role-admin' },
      ip: '127.0.0.1',
      correlationId: 'corr-1',
      occurredAt: '2026-01-15T10:30:00.000Z',
    },
    {
      id: 'log-2',
      actorUserId: null,
      actorType: 'system',
      action: 'CREATE',
      entityType: 'invitation',
      entityId: 'inv-1',
      before: null,
      after: { email: 'newbie@example.com' },
      ip: null,
      correlationId: null,
      occurredAt: '2026-01-15T09:00:00.000Z',
    },
  ];
  return { OWNER_PERMISSIONS, ENTRIES };
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

vi.mock('@/lib/api/resources', () => ({
  getAuditLog: vi.fn().mockResolvedValue({
    entries: h.ENTRIES,
    total: 2,
    page: 1,
    pageSize: 15,
  }),
}));

vi.mock('@/lib/permissions', () => ({
  hasPermission: (granted: readonly string[], required: string) => granted.includes(required),
}));

// The audit page resolves actor ids through the shared member-name hook
// (members cache). Mock it so the page renders with a stable resolver:
// user-1 is a known member, unknown ids fall back to the raw id.
vi.mock('@/lib/hooks/use-member-name', () => ({
  useMemberName: () => (userId: string | null) => (userId === 'user-1' ? 'Owner' : null),
}));

// The react-query mock must stay hoisted, so the query result rides in a
// module-level variable (same pattern as `permissions`) — the empty-state
// test swaps in an empty payload before rendering.
let queryData: { entries: typeof h.ENTRIES; total: number; page: number; pageSize: number } = {
  entries: h.ENTRIES,
  total: 2,
  page: 1,
  pageSize: 15,
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: queryData, isFetching: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import AuditLogSettingsPage from '../page';

function renderPage() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <AuditLogSettingsPage />
    </NextIntlClientProvider>,
  );
}

describe('AuditLogSettingsPage — permission gating (AUTHZ-5)', () => {
  beforeEach(() => {
    permissions = h.OWNER_PERMISSIONS;
  });

  it('AUTHZ-5: an OWNER/ADMIN with platform:audit:view sees the audit log table', async () => {
    renderPage();

    // Scope to the <table>: the entity-type FILTER also renders the strings
    // 'membership'/'invitation' as <option> text, so unqualified getByText
    // would match multiple elements.
    await waitFor(() => {
      const table = screen.getByRole('table');
      expect(within(table).getByText('membership')).toBeInTheDocument();
      expect(within(table).getByText('invitation')).toBeInTheDocument();
    });
    // Action badges rendered for both entries.
    expect(screen.getAllByText('Update').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Create').length).toBeGreaterThan(0);
    // The actor column resolves the member id to a display name.
    expect(within(screen.getByRole('table')).getByText('Owner')).toBeInTheDocument();
  });

  it('AUTHZ-5: a MEMBER without platform:audit:view sees the AccessDenied gate instead of the table', async () => {
    permissions = ['platform:data:read'];

    renderPage();

    await waitFor(() => expect(screen.getByText('Access denied')).toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('AuditLogSettingsPage — rendering + filters', () => {
  beforeEach(() => {
    permissions = h.OWNER_PERMISSIONS;
  });

  it('shows the system actor label for null actor ids', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText('System')).toBeInTheDocument());
  });

  it('renders before/after snapshot summaries', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(/roleId: role-admin/)).toBeInTheDocument());
    expect(screen.getByText(/email: newbie@example.com/)).toBeInTheDocument();
  });

  it('filters by entity type and action', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    const entityFilter = screen.getByRole('combobox', { name: 'All entity types' });
    await user.click(entityFilter);
    await user.click(await screen.findByRole('option', { name: 'invitation' }));

    // The filter control reflects the change (the query is server-driven via
    // the query key; the mocked query returns all entries regardless).
    expect(entityFilter).toHaveTextContent('invitation');
  });

  it('shows the empty state when there are no entries', async () => {
    queryData = { entries: [], total: 0, page: 1, pageSize: 15 };

    renderPage();

    await waitFor(() => expect(screen.getByText('No audit entries found.')).toBeInTheDocument());
  });
});
