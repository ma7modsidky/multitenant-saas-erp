// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const switchOrg = vi.fn().mockResolvedValue(undefined);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/api/resources', () => ({
  createOrganization: vi.fn(),
  getActiveOrganization: vi.fn(),
  getMyOrganizations: vi.fn(),
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

vi.mock('@/lib/entitlements', () => ({
  useNavigation: () => ({ data: [], isLoading: false }),
  useEntitlements: () => ({ data: undefined }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import DashboardPage from '../page';

function renderDashboard() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <DashboardPage />
    </NextIntlClientProvider>,
  );
}

describe('DashboardPage — create-org onboarding (org auto-select lives in ShellLayout)', () => {
  beforeEach(() => {
    switchOrg.mockClear();
  });

  it('AUTHZ-5: the dashboard renders the create-org form while org-less; auto-select is owned by ShellLayout', () => {
    renderDashboard();

    // The dashboard renders the onboarding state while org-less; ShellLayout
    // (which wraps this page in the (dashboard) layout) performs the switch.
    expect(screen.getByText('Create your organization')).toBeInTheDocument();
    expect(switchOrg).not.toHaveBeenCalled();
  });
});
