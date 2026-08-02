// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { render, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const switchOrg = vi.fn().mockResolvedValue(undefined);
// Typed to return `unknown` so the vi.mock factory boundary below stays lint-clean
// (a bare vi.fn() returns `any`, which trips no-unsafe-return/no-unsafe-assignment).
const getMyOrganizations = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/en/settings/members',
}));

vi.mock('@/lib/api/resources', () => ({
  getMyOrganizations: (...args: unknown[]) => getMyOrganizations(...args),
}));

vi.mock('@/lib/auth/session-context', () => ({
  useSession: () => ({
    status: 'authenticated',
    user: { id: 'u1', email: 'a@b.c', name: 'A B', preferredLocale: 'en', emailVerified: true },
    organizationId: null,
    permissions: [],
    login: vi.fn(),
    switchOrg,
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  // The mock hands back the mocked fetch result as the query's `data` field.
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[0] === 'my-organizations-shell' ? { data: getMyOrganizations() } : { data: undefined },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { ShellLayout } from '../shell-layout';

function renderShell() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <ShellLayout>
        <div>page-content</div>
      </ShellLayout>
    </NextIntlClientProvider>,
  );
}

describe('ShellLayout — auto-select first org on ANY dashboard route (AUTHZ-5 login-claims UX fix)', () => {
  beforeEach(() => {
    switchOrg.mockClear();
    getMyOrganizations.mockReset();
  });

  it('AUTHZ-5: a returning member landing DIRECTLY on /settings/members with an org-less token is auto-switched into their FIRST org', async () => {
    getMyOrganizations.mockReturnValue([
      { organizationId: 'org-1', organizationName: 'Alpha', organizationStatus: 'active' },
      { organizationId: 'org-2', organizationName: 'Beta', organizationStatus: 'active' },
    ]);

    renderShell();

    // The layout wraps every (dashboard) route — a deep link to a settings
    // page must still restore the org context so the sidebar and the
    // permission-gated controls (role dropdown, invite, remove) appear.
    await waitFor(() => expect(switchOrg).toHaveBeenCalledTimes(1));
    expect(switchOrg).toHaveBeenCalledWith('org-1');
  });

  it('AUTHZ-5: a brand-new user with no organizations triggers no auto-switch', async () => {
    getMyOrganizations.mockReturnValue([]);

    renderShell();

    await waitFor(() => expect(getMyOrganizations).toHaveBeenCalled());
    expect(switchOrg).not.toHaveBeenCalled();
  });

  it('AUTHZ-5: does not auto-switch while the membership query is still loading (pending ≠ no memberships)', () => {
    // The query's `data` is undefined while the fetch is in flight — pending
    // must NOT be treated as "brand-new user" (that would permanently suppress
    // the auto-select for returning members on a slow network).
    getMyOrganizations.mockReturnValue(undefined);

    renderShell();

    expect(switchOrg).not.toHaveBeenCalled();
  });
});
