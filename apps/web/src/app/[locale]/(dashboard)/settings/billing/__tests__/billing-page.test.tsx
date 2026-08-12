// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Entitlement } from '@/lib/api/types';

// Module-level mutable fixture — the react-query mock reads it at render time
// (same hoisted pattern as the audit and modules page tests).
let entitlementsData: Entitlement[] = [];

vi.mock('@/lib/auth/session-context', () => ({
  useSession: () => ({
    status: 'authenticated',
    user: { id: 'user-1', email: 'owner@example.com', name: 'Owner', preferredLocale: 'en', emailVerified: true },
    organizationId: 'org-1',
    permissions: ['platform:billing:manage'],
    login: vi.fn(),
    switchOrg: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}));

vi.mock('@/lib/permissions', () => ({
  hasPermission: (granted: readonly string[], required: string) => granted.includes(required),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { subscription: null, entitlements: entitlementsData } }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/lib/api/resources', () => ({
  getBilling: vi.fn().mockResolvedValue({ subscription: null, entitlements: [] }),
  disableBillingModule: vi.fn().mockResolvedValue({ message: 'ok' }),
}));

import BillingSettingsPage from '../page';

beforeEach(() => {
  entitlementsData = [];
});

function renderPage() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <BillingSettingsPage />
    </NextIntlClientProvider>,
  );
}

describe('BillingSettingsPage — module state badges', () => {
  it('renders localized state labels instead of raw state codes', () => {
    entitlementsData = [
      { moduleKey: 'pos', state: 'active', trialEndsAt: null, activatedAt: null },
      { moduleKey: 'inventory', state: 'trialing', trialEndsAt: null, activatedAt: null },
      { moduleKey: 'crm', state: 'past_due', trialEndsAt: null, activatedAt: null },
    ];

    renderPage();

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Trial')).toBeInTheDocument();
    expect(screen.getByText('Past due')).toBeInTheDocument();
    // Raw codes never surface.
    expect(screen.queryByText('active')).not.toBeInTheDocument();
    expect(screen.queryByText('trialing')).not.toBeInTheDocument();
  });

  it('labels the less common states too (disabled, expired, suspended)', () => {
    entitlementsData = [
      { moduleKey: 'pos', state: 'disabled', trialEndsAt: null, activatedAt: null },
      { moduleKey: 'inventory', state: 'expired', trialEndsAt: null, activatedAt: null },
      { moduleKey: 'crm', state: 'suspended', trialEndsAt: null, activatedAt: null },
    ];

    renderPage();

    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });

  it('shows no badge for a none-state entitlement', () => {
    entitlementsData = [{ moduleKey: 'crm', state: 'none', trialEndsAt: null, activatedAt: null }];

    renderPage();

    // Module name renders, but no badge and no raw 'none' code.
    expect(screen.getByText('CRM')).toBeInTheDocument();
    expect(screen.queryByText('none')).not.toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });
});
