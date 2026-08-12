// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api';
import { disableBillingModule, enableModuleTrial } from '@/lib/api/resources';
import type { Entitlement, ModuleDefinition } from '@/lib/api/types';

// vi.mock factories are hoisted above the top-level data, so fixture data must
// live in vi.hoisted() to be referenceable from the factories.
const h = vi.hoisted(() => {
  const CATALOG: ModuleDefinition[] = [
    {
      key: 'crm',
      nameKey: 'modules.crm.name',
      descriptionKey: 'modules.crm.description',
      icon: null,
      dependsOn: [],
      trialDays: 14,
    },
    {
      key: 'inventory',
      nameKey: 'modules.inventory.name',
      descriptionKey: 'modules.inventory.description',
      icon: null,
      dependsOn: [],
      trialDays: 14,
    },
    {
      key: 'pos',
      nameKey: 'modules.pos.name',
      descriptionKey: 'modules.pos.description',
      icon: null,
      dependsOn: ['inventory'],
      trialDays: 14,
    },
  ];
  return { CATALOG };
});

// Module-level mutable fixtures — the react-query mock reads these at render
// time, so each test swaps in the shape it needs (same pattern as the audit
// page test).
let catalogData: ModuleDefinition[] = h.CATALOG;
let entitlementsData: Entitlement[] = [];

vi.mock('@/lib/auth/session-context', () => ({
  useSession: () => ({
    status: 'authenticated',
    user: { id: 'user-1', email: 'owner@example.com', name: 'Owner', preferredLocale: 'en', emailVerified: true },
    organizationId: 'org-1',
    permissions: [],
    login: vi.fn(),
    switchOrg: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  }),
}));

// The page pulls the shared ModuleStateBadge from its own module path, so
// this mock only needs to override the entitlements hook.
vi.mock('@/lib/entitlements', () => ({
  useEntitlements: () => ({ data: { subscription: null, entitlements: entitlementsData } }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: catalogData }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/lib/api/resources', () => ({
  getModuleCatalog: vi.fn().mockResolvedValue(h.CATALOG),
  enableModuleTrial: vi.fn().mockResolvedValue({ message: 'ok' }),
  disableBillingModule: vi.fn().mockResolvedValue({ message: 'ok' }),
}));

import ModulesSettingsPage from '../page';

beforeEach(() => {
  catalogData = h.CATALOG;
  entitlementsData = [];
  vi.mocked(enableModuleTrial).mockReset();
  vi.mocked(disableBillingModule).mockReset();
  vi.mocked(enableModuleTrial).mockResolvedValue({ message: 'ok' });
  vi.mocked(disableBillingModule).mockResolvedValue({ message: 'ok' });
});

function renderPage() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <ModulesSettingsPage />
    </NextIntlClientProvider>,
  );
}

function posCard() {
  return screen.getByTestId('module-card-pos');
}

function inventoryCard() {
  return screen.getByTestId('module-card-inventory');
}

describe('ModulesSettingsPage — state badges', () => {
  it('renders localized state badges instead of raw state codes', () => {
    entitlementsData = [
      { moduleKey: 'pos', state: 'trialing', trialEndsAt: null, activatedAt: null },
      { moduleKey: 'inventory', state: 'active', trialEndsAt: null, activatedAt: null },
      { moduleKey: 'crm', state: 'past_due', trialEndsAt: null, activatedAt: null },
    ];

    renderPage();

    expect(within(posCard()).getByText('Trial')).toBeInTheDocument();
    expect(within(inventoryCard()).getByText('Active')).toBeInTheDocument();
    expect(within(screen.getByTestId('module-card-crm')).getByText('Past due')).toBeInTheDocument();
    // Raw codes never surface.
    expect(screen.queryByText('trialing')).not.toBeInTheDocument();
    expect(screen.queryByText('active')).not.toBeInTheDocument();
  });

  it('shows no badge for a module that is not activated', () => {
    renderPage();

    // No module has an entitlement — no badge anywhere.
    expect(screen.queryByText('Trial')).not.toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.queryByText('none')).not.toBeInTheDocument();
    // The trial offer line stands in for the old meaningless badge.
    expect(within(posCard()).getByText('14-day free trial')).toBeInTheDocument();
  });

  it('shows the Requires line naming the dependency on the POS card', () => {
    renderPage();

    expect(within(posCard()).getByText(/Requires:/)).toBeInTheDocument();
    expect(within(posCard()).getByText('Inventory')).toBeInTheDocument();
    // Modules without dependencies don't get the line.
    expect(within(inventoryCard()).queryByText(/Requires:/)).not.toBeInTheDocument();
  });

  it('marks a not-yet-active dependency as (not active)', () => {
    renderPage();

    expect(within(posCard()).getByText('(not active)')).toBeInTheDocument();
  });

  it('shows the live trial countdown on a trialing module card', () => {
    entitlementsData = [
      {
        moduleKey: 'pos',
        state: 'trialing',
        trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        activatedAt: null,
      },
    ];

    renderPage();

    // The card switches from the static trial-length line to the countdown.
    expect(within(posCard()).getByText(/5 days left in trial/)).toBeInTheDocument();
    // The static offer is gone for an active trial.
    expect(within(posCard()).queryByText('14-day free trial')).not.toBeInTheDocument();
  });

  it('keeps the static trial offer for a not-yet-activated module', () => {
    renderPage();

    expect(within(posCard()).getByText('14-day free trial')).toBeInTheDocument();
  });
});

describe('ModulesSettingsPage — enabling with dependencies', () => {
  it('offers to activate a missing dependency via dialog, then enables both', async () => {
    const user = userEvent.setup();
    renderPage();

    // POS requires Inventory, which is not activated → dialog, not an error.
    await user.click(within(posCard()).getByRole('button', { name: 'Start free trial' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Activate POS?')).toBeInTheDocument();
    expect(within(dialog).getByText(/needs Inventory to work/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Activate Inventory too' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Dependency first, then the target module.
    expect(enableModuleTrial).toHaveBeenNthCalledWith(1, 'org-1', 'inventory');
    expect(enableModuleTrial).toHaveBeenNthCalledWith(2, 'org-1', 'pos');
    // No server rejection surfaced as an inline error.
    expect(within(posCard()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('enables directly when all dependencies are already active', async () => {
    const user = userEvent.setup();
    entitlementsData = [{ moduleKey: 'inventory', state: 'trialing', trialEndsAt: null, activatedAt: null }];

    renderPage();

    await user.click(within(posCard()).getByRole('button', { name: 'Start free trial' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(enableModuleTrial).toHaveBeenCalledWith('org-1', 'pos'));
    expect(enableModuleTrial).not.toHaveBeenCalledWith('org-1', 'inventory');
  });

  it('maps a server-side dependency rejection to a friendly inline error', async () => {
    const user = userEvent.setup();
    vi.mocked(enableModuleTrial).mockRejectedValueOnce(new ApiError(409, { code: 'MODULE_DEPENDENCY_MISSING' }));

    renderPage();

    // No entitlements → the client dialog would normally intercept, but a
    // stale state must still fail with a readable message, not a raw code.
    await user.click(within(posCard()).getByRole('button', { name: 'Start free trial' }));
    await user.click(await screen.findByRole('button', { name: 'Activate Inventory too' }));

    await waitFor(() =>
      expect(within(posCard()).getByRole('alert')).toHaveTextContent(
        'Could not activate POS: Inventory must be active first.',
      ),
    );
  });
});

describe('ModulesSettingsPage — disabling with dependents', () => {
  it('warns that dependent modules will be disabled too, then disables them in order', async () => {
    const user = userEvent.setup();
    entitlementsData = [
      { moduleKey: 'pos', state: 'trialing', trialEndsAt: null, activatedAt: null },
      { moduleKey: 'inventory', state: 'trialing', trialEndsAt: null, activatedAt: null },
    ];

    renderPage();

    // Disabling Inventory must cascade to POS (its dependent).
    await user.click(within(inventoryCard()).getByRole('button', { name: 'Disable' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Disable Inventory?')).toBeInTheDocument();
    expect(within(dialog).getByText(/will also disable POS/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Disable POS too' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(disableBillingModule).toHaveBeenNthCalledWith(1, 'org-1', 'pos');
    expect(disableBillingModule).toHaveBeenNthCalledWith(2, 'org-1', 'inventory');
  });

  it('disables a module without dependents after a plain confirmation', async () => {
    const user = userEvent.setup();
    entitlementsData = [{ moduleKey: 'inventory', state: 'trialing', trialEndsAt: null, activatedAt: null }];

    renderPage();

    await user.click(within(inventoryCard()).getByRole('button', { name: 'Disable' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Disable Inventory?')).toBeInTheDocument();
    // No dependents → the plain disable confirmation text.
    expect(
      within(dialog).getByText('Disable this module? You will lose access until you re-enable it.'),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(disableBillingModule).toHaveBeenCalledWith('org-1', 'inventory');
  });

  it('maps a dependent-module rejection to a friendly disable error (never the trial text)', async () => {
    const user = userEvent.setup();
    entitlementsData = [{ moduleKey: 'inventory', state: 'trialing', trialEndsAt: null, activatedAt: null }];
    vi.mocked(disableBillingModule).mockRejectedValueOnce(new ApiError(409, { code: 'MODULE_DEPENDENCY_CONFLICT' }));

    renderPage();

    await user.click(within(inventoryCard()).getByRole('button', { name: 'Disable' }));
    // Scope to the dialog — the confirm label 'Disable' also matches the card button.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Disable' }));

    await waitFor(() =>
      expect(within(inventoryCard()).getByRole('alert')).toHaveTextContent(
        'Could not disable Inventory — POS must be disabled first.',
      ),
    );
    // The old bug: the disable failure showed the start-trial error text.
    expect(screen.queryByText(/Could not start the trial/)).not.toBeInTheDocument();
  });

  it('shows a generic disable message for unknown failures', async () => {
    const user = userEvent.setup();
    entitlementsData = [{ moduleKey: 'inventory', state: 'trialing', trialEndsAt: null, activatedAt: null }];
    vi.mocked(disableBillingModule).mockRejectedValueOnce(new ApiError(500, { code: 'INTERNAL_ERROR' }));

    renderPage();

    await user.click(within(inventoryCard()).getByRole('button', { name: 'Disable' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Disable' }));

    await waitFor(() =>
      expect(within(inventoryCard()).getByRole('alert')).toHaveTextContent(
        'Could not disable the module. Please try again.',
      ),
    );
    expect(screen.queryByText('INTERNAL_ERROR')).not.toBeInTheDocument();
  });
});
