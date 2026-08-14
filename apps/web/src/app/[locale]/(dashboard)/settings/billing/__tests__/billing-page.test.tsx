// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Entitlement } from '@/lib/api/types';

// Module-level mutable fixtures — the react-query mock reads them at render
// time (same hoisted pattern as the audit and modules page tests).
let entitlementsData: Entitlement[] = [];
let subscriptionData: { currentPeriodEnd: string | null } | null = null;

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
  useQuery: () => ({ data: { subscription: subscriptionData, entitlements: entitlementsData } }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/lib/api/resources', () => ({
  getBilling: vi.fn().mockResolvedValue({ subscription: null, entitlements: [] }),
  disableBillingModule: vi.fn().mockResolvedValue({ message: 'ok' }),
}));

import BillingSettingsPage from '../page';

beforeEach(() => {
  entitlementsData = [];
  subscriptionData = null;
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
      { moduleKey: 'pos', state: 'active', trialStartedAt: null, trialEndsAt: null, activatedAt: null },
      { moduleKey: 'inventory', state: 'trialing', trialStartedAt: null, trialEndsAt: null, activatedAt: null },
      { moduleKey: 'crm', state: 'past_due', trialStartedAt: null, trialEndsAt: null, activatedAt: null },
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
      { moduleKey: 'pos', state: 'disabled', trialStartedAt: null, trialEndsAt: null, activatedAt: null },
      { moduleKey: 'inventory', state: 'expired', trialStartedAt: null, trialEndsAt: null, activatedAt: null },
      { moduleKey: 'crm', state: 'suspended', trialStartedAt: null, trialEndsAt: null, activatedAt: null },
    ];

    renderPage();

    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });

  it('shows no badge for a none-state entitlement', () => {
    entitlementsData = [
      { moduleKey: 'crm', state: 'none', trialStartedAt: null, trialEndsAt: null, activatedAt: null },
    ];

    renderPage();

    // Module name renders, but no badge and no raw 'none' code.
    expect(screen.getByText('CRM')).toBeInTheDocument();
    expect(screen.queryByText('none')).not.toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });
});

describe('BillingSettingsPage — trial dates and days remaining', () => {
  it('shows the end date and a live days-left countdown for a trialing module', () => {
    entitlementsData = [
      {
        moduleKey: 'inventory',
        state: 'trialing',
        trialStartedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
        trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        activatedAt: null,
      },
    ];

    renderPage();

    // End date line + the pluralized countdown (assert via text, not the
    // locale-dependent date string).
    expect(screen.getByText(/Ends .*· .*5 days left in trial/)).toBeInTheDocument();
  });

  it('shows the ended date for an expired trial', () => {
    entitlementsData = [
      {
        moduleKey: 'crm',
        state: 'expired',
        trialStartedAt: '2026-08-01T00:00:00.000Z',
        trialEndsAt: '2026-08-12T00:00:00.000Z',
        activatedAt: null,
      },
    ];

    renderPage();

    expect(screen.getByText(/Trial ended/)).toBeInTheDocument();
  });

  it('marks a module disabled after its trial as trial used (BILL-2)', () => {
    entitlementsData = [
      {
        moduleKey: 'pos',
        state: 'disabled',
        trialStartedAt: '2026-08-02T00:00:00.000Z',
        trialEndsAt: '2026-08-13T00:00:00.000Z',
        activatedAt: null,
      },
    ];

    renderPage();

    expect(screen.getByText('Trial used')).toBeInTheDocument();
  });

  it('shows no trial line for paid or suspended modules', () => {
    entitlementsData = [
      { moduleKey: 'pos', state: 'active', trialStartedAt: null, trialEndsAt: null, activatedAt: null },
      { moduleKey: 'crm', state: 'suspended', trialStartedAt: null, trialEndsAt: null, activatedAt: null },
    ];

    renderPage();

    expect(screen.queryByText(/Ends/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Trial/)).not.toBeInTheDocument();
  });
});

describe('BillingSettingsPage — active module expiry (PLT-8/BILL-14)', () => {
  it('shows the subscription period end for a PAID active module', () => {
    subscriptionData = { currentPeriodEnd: '2026-09-01T00:00:00.000Z' };
    entitlementsData = [
      {
        moduleKey: 'pos',
        state: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        activatedAt: null,
        isPaid: true,
        accessUntil: null,
      },
    ];

    renderPage();

    expect(screen.getByText(/Active until/)).toBeInTheDocument();
  });

  it('shows the grant end date for a time-boxed free grant', () => {
    entitlementsData = [
      {
        moduleKey: 'pos',
        state: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        activatedAt: null,
        isPaid: false,
        accessUntil: '2026-10-15T00:00:00.000Z',
      },
    ];

    renderPage();

    expect(screen.getByText(/Access until/)).toBeInTheDocument();
  });

  it('shows no expiry line for an unlimited free grant', () => {
    entitlementsData = [
      {
        moduleKey: 'pos',
        state: 'active',
        trialStartedAt: null,
        trialEndsAt: null,
        activatedAt: null,
        isPaid: false,
        accessUntil: null,
      },
    ];

    renderPage();

    expect(screen.queryByText(/until/i)).not.toBeInTheDocument();
  });
});
