// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above the top-level data, so mock data must
// live in vi.hoisted() to be referenceable from the factories.
const h = vi.hoisted(() => {
  const ORG = {
    data: {
      id: 'org-1',
      name: 'Acme Inc',
      slug: 'acme',
      countryCode: 'US',
      timezone: 'UTC',
      baseCurrency: 'USD',
      defaultLocale: 'en',
      status: 'active',
    },
    settings: {
      id: 'set-1',
      organizationId: 'org-1',
      locale: 'en',
      timezone: 'UTC',
      baseCurrency: 'USD',
      receiptFooter: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
  const MY_ORGS = [{ organizationId: 'org-1', organizationName: 'Acme Inc', status: 'active', current: true }];
  return { ORG, MY_ORGS };
});

// Session permissions are mutable per-test (owner vs plain viewer).
let permissions: string[] = ['platform:settings:manage', 'platform:organization:delete'];

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

vi.mock('@/lib/permissions', () => ({
  hasPermission: (granted: readonly string[], required: string) => granted.includes(required),
}));

const { updateOrganizationMock, updateOrganizationSettingsMock } = vi.hoisted(() => ({
  updateOrganizationMock: vi.fn().mockResolvedValue(h.ORG.data),
  updateOrganizationSettingsMock: vi.fn().mockResolvedValue(h.ORG.settings),
}));

vi.mock('@/lib/api/resources', () => ({
  getOrganization: vi.fn().mockResolvedValue(h.ORG),
  getMyOrganizations: vi.fn().mockResolvedValue(h.MY_ORGS),
  updateOrganization: updateOrganizationMock,
  updateOrganizationSettings: updateOrganizationSettingsMock,
  deleteOrganization: vi.fn().mockResolvedValue({ deletionScheduledAt: '', message: '' }),
  cancelOrganizationDeletion: vi.fn().mockResolvedValue(h.ORG.data),
}));

// The page uses the real Combobox (backed by the localization l10n data) and
// the real useOrgLocalization hook — no mock needed; the l10n lookups return
// stable option lists for the en locale.

const { invalidateMock } = vi.hoisted(() => ({
  invalidateMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    switch (queryKey[0]) {
      case 'organization':
        return { data: h.ORG };
      case 'my-organizations':
        return { data: h.MY_ORGS };
      default:
        return { data: undefined };
    }
  },
  useQueryClient: () => ({ invalidateQueries: invalidateMock }),
}));

import OrganizationSettingsPage from '../page';

function renderPage() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <OrganizationSettingsPage />
    </NextIntlClientProvider>,
  );
}

describe('OrganizationSettingsPage — edit gating (AUTHZ-5 / BUSINESS_RULES §3)', () => {
  beforeEach(() => {
    permissions = ['platform:settings:manage', 'platform:organization:delete'];
    updateOrganizationMock.mockClear();
    updateOrganizationSettingsMock.mockClear();
    invalidateMock.mockClear();
  });

  it('AUTHZ-5: an OWNER/ADMIN with platform:settings:manage sees the editable profile form', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByLabelText('Organization name')).toBeInTheDocument());

    // The editable form renders the save action.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    // The danger zone (org deletion) is OWNER-only and visible to this user.
    expect(screen.getByText('Danger zone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete organization' })).toBeInTheDocument();
  });

  it('AUTHZ-5: a VIEWER without platform:settings:manage sees a read-only view — no form, no save', async () => {
    permissions = ['platform:data:read'];

    renderPage();

    // Read-only view shows the hint and the org details...
    await waitFor(() =>
      expect(
        screen.getByText('Only owners and administrators can edit organization profile and settings.'),
      ).toBeInTheDocument(),
    );
    // 'Acme Inc' appears twice on the page (org-switcher label + read-only
    // detail row), so assert via getAllByText.
    expect(screen.getAllByText('Acme Inc').length).toBeGreaterThan(0);

    // ...but NO editable inputs and NO save action.
    expect(screen.queryByLabelText('Organization name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    // Danger zone is OWNER-only (platform:organization:delete) — hidden.
    expect(screen.queryByText('Danger zone')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete organization' })).not.toBeInTheDocument();
  });

  it('AUTHZ-5: an ADMIN with settings:manage but without organization:delete sees the form but no danger zone', async () => {
    // ADMIN holds platform:settings:manage but NOT platform:organization:delete
    // (delete is OWNER-only per the §3 matrix) — the form must render while
    // the danger zone stays hidden.
    permissions = ['platform:settings:manage'];

    renderPage();

    await waitFor(() => expect(screen.getByLabelText('Organization name')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByText('Danger zone')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete organization' })).not.toBeInTheDocument();
  });

  it('saves profile changes through updateOrganization + updateOrganizationSettings when permitted', async () => {
    const user = userEvent.setup();

    renderPage();

    // Wait for the hydration effect to fill the input (label renders before
    // the value is set) so clear/type can't race with hydration overwriting
    // the typed value with the server-provided 'Acme Inc'.
    await waitFor(() => expect(screen.getByLabelText('Organization name')).toHaveValue('Acme Inc'));

    await user.clear(screen.getByLabelText('Organization name'));
    await user.type(screen.getByLabelText('Organization name'), 'Acme Rebranded');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateOrganizationMock).toHaveBeenCalledWith('org-1', expect.objectContaining({ name: 'Acme Rebranded' })),
    );
    expect(updateOrganizationSettingsMock).toHaveBeenCalledWith('org-1', { receiptFooter: null });
  });
});
