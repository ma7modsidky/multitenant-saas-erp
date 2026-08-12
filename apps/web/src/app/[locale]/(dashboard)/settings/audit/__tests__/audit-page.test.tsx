// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuditLog } from '@/lib/api/resources';

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
      entityId: '3a2f9c1e-8d4b-4f2a-9c3d-7e1b5a8f2c11',
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
    {
      id: 'log-3',
      actorUserId: 'user-1',
      actorType: 'user',
      action: 'CREATE',
      entityType: 'stock_count',
      entityId: 'unknown',
      before: null,
      after: null,
      ip: null,
      correlationId: null,
      occurredAt: '2026-01-15T08:00:00.000Z',
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
    total: 3,
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
  total: 3,
  page: 1,
  pageSize: 15,
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: queryData, isFetching: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import AuditLogSettingsPage from '../page';

// Every test starts from the populated fixture — the empty-state test swaps in
// an empty payload locally and must not leak it to later tests.
beforeEach(() => {
  queryData = { entries: h.ENTRIES, total: 3, page: 1, pageSize: 15 };
});

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

    // Entity types render as human labels, not raw codes. Scope to the <table>:
    // the entity-type FILTER also renders the labels as <option> text.
    await waitFor(() => {
      const table = screen.getByRole('table');
      expect(within(table).getByText('Membership')).toBeInTheDocument();
      expect(within(table).getByText('Invitation')).toBeInTheDocument();
    });
    // Action badges rendered for both entries.
    expect(screen.getAllByText('Update').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Create').length).toBeGreaterThan(0);
    // The actor column resolves the member id to a display name (two rows
    // share the user-1 actor → Owner appears in both).
    expect(within(screen.getByRole('table')).getAllByText('Owner').length).toBeGreaterThan(0);
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

  it('renders humanized, formatted details summaries (no raw JSON)', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.getByText('Role ID: role-admin')).toBeInTheDocument();
    expect(screen.getByText('Email: newbie@example.com')).toBeInTheDocument();
  });

  it('truncates long entity ids and hides ids recorded as "unknown"', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    // Long id → short form with ellipsis (full id available via title).
    expect(screen.getByText('3a2f9c1e…')).toBeInTheDocument();
    // The literal 'unknown' string never reaches the table.
    expect(screen.queryByText('unknown')).not.toBeInTheDocument();
  });

  it('copies the full entity id from the copy button', async () => {
    // NOTE: must NOT call userEvent.setup() here — it re-installs its own
    // navigator.clipboard stub, wiping this mock. fireEvent keeps the spy.
    const writeText = vi.fn().mockResolvedValue(undefined);
    // Cover both the bare global and the window property (whichever the
    // component's realm resolves) — same object when they are the same.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    const copyButtons = screen.getAllByRole('button', { name: 'Copy ID' });
    fireEvent.click(copyButtons[0]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('3a2f9c1e-8d4b-4f2a-9c3d-7e1b5a8f2c11'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
  });

  it('filters by entity type and action', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    const entityFilter = screen.getByRole('combobox', { name: 'All entity types' });
    await user.click(entityFilter);
    await user.click(await screen.findByRole('option', { name: 'Invitation' }));

    // The filter control reflects the change (the query is server-driven via
    // the query key; the mocked query returns all entries regardless).
    expect(entityFilter).toHaveTextContent('Invitation');
  });

  it('shows the empty state when there are no entries', async () => {
    queryData = { entries: [], total: 0, page: 1, pageSize: 15 };

    renderPage();

    await waitFor(() => expect(screen.getByText('No audit entries found.')).toBeInTheDocument());
  });
});

describe('AuditLogSettingsPage — detail dialog', () => {
  beforeEach(() => {
    permissions = h.OWNER_PERMISSIONS;
  });

  it('opens the detail dialog from the view-details button with metadata and the diff', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    await user.click(screen.getAllByRole('button', { name: 'View details' })[0]!);

    const dialog = await screen.findByRole('dialog');
    // Traceability metadata.
    expect(within(dialog).getByText('127.0.0.1')).toBeInTheDocument();
    expect(within(dialog).getByText('corr-1')).toBeInTheDocument();
    // Full (untruncated) entity id in the dialog.
    expect(within(dialog).getByText('3a2f9c1e-8d4b-4f2a-9c3d-7e1b5a8f2c11')).toBeInTheDocument();
    // Field-level diff.
    expect(within(dialog).getByText('Changes')).toBeInTheDocument();
    expect(within(dialog).getByText('Role ID')).toBeInTheDocument();
    expect(within(dialog).getByText('role-admin')).toBeInTheDocument();
  });

  it('closes the detail dialog with the close button', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    await user.click(screen.getAllByRole('button', { name: 'View details' })[0]!);
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('AuditLogSettingsPage — CSV export', () => {
  beforeEach(() => {
    permissions = h.OWNER_PERMISSIONS;
  });

  it('exports all filtered entries as a CSV with the humanized labels', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    renderPage();
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
    // eslint-disable-next-line no-restricted-syntax -- jsdom mock: read the anchor from the click spy's `this`
    const anchor = clickSpy.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');

    // The export walks ALL matching pages at the API max page size (200),
    // not the table's 15-per-page view.
    expect(getAuditLog).toHaveBeenCalledWith('org-1', expect.objectContaining({ page: 1, pageSize: 200 }));

    // CSV carries the same humanized labels as the table.
    const blob = createObjectURL.mock.calls[0]![0];
    expect(blob.type).toBe('text/csv;charset=utf-8');
    const csvText = await blob.text();
    expect(csvText).toContain('Membership');
    expect(csvText).toContain('Update');
    expect(csvText).toContain('Role ID: role-admin');

    // Transient success state on the button.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Exported' })).toBeInTheDocument());
  });
});
