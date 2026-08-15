// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/en/settings';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  // The sidebar renders <SidebarSearch>, which uses useRouter to navigate.
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const getNavigation = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/lib/auth/session-context', () => ({
  useSession: () => ({
    organizationId: 'org-1',
    permissions: ['platform:members:invite', 'platform:roles:manage', 'platform:billing:manage', 'platform:audit:view'],
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  // Hand back the mocked navigation payload as the query's `data` field.
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[0] === 'navigation' ? { data: getNavigation() } : { data: undefined },
}));

import { Sidebar } from '../sidebar';

// Mirrors GET /v1/me/navigation: one group per entitled module.
const NAV = [
  {
    moduleKey: 'crm',
    labelKey: 'modules.crm.name',
    items: [
      { labelKey: 'modules.crm.nav.contacts', href: '/m/crm/contacts' },
      { labelKey: 'modules.crm.nav.companies', href: '/m/crm/companies' },
      { labelKey: 'modules.crm.nav.deals', href: '/m/crm/deals' },
      { labelKey: 'modules.crm.nav.activities', href: '/m/crm/activities' },
    ],
  },
  {
    moduleKey: 'inventory',
    labelKey: 'modules.inventory.name',
    items: [
      { labelKey: 'modules.inventory.nav.products', href: '/m/inventory/products' },
      { labelKey: 'modules.inventory.nav.warehouses', href: '/m/inventory/warehouses' },
      {
        labelKey: 'modules.inventory.nav.stock',
        href: '/m/inventory/stock',
        // Stock owns its sub-routes — the sidebar must render them nested so
        // reservations reads as under Stock, not a floating sibling.
        children: [
          { labelKey: 'modules.inventory.nav.movements', href: '/m/inventory/stock/movements' },
          { labelKey: 'modules.inventory.nav.transfers', href: '/m/inventory/stock/transfers' },
          { labelKey: 'modules.inventory.nav.reservations', href: '/m/inventory/stock/reservations' },
        ],
      },
    ],
  },
];

function renderSidebar({ collapsed = false }: { collapsed?: boolean } = {}) {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <Sidebar collapsed={collapsed} />
    </NextIntlClientProvider>,
  );
}

describe('Sidebar — grouped module navigation', () => {
  beforeEach(() => {
    pathname = '/en/settings';
    getNavigation.mockReset();
    getNavigation.mockReturnValue(NAV);
  });

  it("nests each module's links under a collapsible parent", () => {
    renderSidebar();

    // Parents are visible; their children start hidden.
    const crmToggle = screen.getByRole('button', { name: 'CRM' });
    expect(screen.queryByRole('link', { name: 'Contacts' })).not.toBeInTheDocument();

    fireEvent.click(crmToggle);
    expect(crmToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Contacts' })).toHaveAttribute('href', '/en/m/crm/contacts');
    expect(screen.getByRole('link', { name: 'Activities' })).toBeInTheDocument();
    // Other modules stay closed.
    expect(screen.queryByRole('link', { name: 'Products' })).not.toBeInTheDocument();

    fireEvent.click(crmToggle);
    expect(screen.queryByRole('link', { name: 'Contacts' })).not.toBeInTheDocument();
  });

  it('auto-expands the module owning the active route (child routes included)', () => {
    // /m/crm/deals/table is a child route of the Deals page link.
    pathname = '/en/m/crm/deals/table';
    renderSidebar();

    expect(screen.getByRole('link', { name: 'Deals' })).toBeInTheDocument();
    // The active child link highlights (prefix match)...
    expect(screen.getByRole('link', { name: 'Deals' })).toHaveClass('bg-accent');
    // ...and other modules stay collapsed.
    expect(screen.queryByRole('link', { name: 'Products' })).not.toBeInTheDocument();
  });

  it('flattens modules into icon-only shortcuts when the rail is collapsed', () => {
    pathname = '/en/m/crm/contacts';
    renderSidebar({ collapsed: true });

    // No dropdown parents in the collapsed rail — every page stays reachable
    // as an icon link with a tooltip (nested stock children included).
    expect(screen.queryByRole('button', { name: 'CRM' })).not.toBeInTheDocument();
    expect(screen.getByTitle('Contacts')).toBeInTheDocument();
    expect(screen.getByTitle('Products')).toBeInTheDocument();
    expect(screen.getByTitle('Reservations')).toBeInTheDocument();
  });

  it('nests stock sub-routes under Stock (reservations is not a sibling)', () => {
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }));

    // Stock renders with its sub-routes nested beneath it — Movements,
    // Transfers, and Reservations are children, not top-level items.
    expect(screen.getByRole('link', { name: 'Stock' })).toHaveAttribute('href', '/en/m/inventory/stock');
    expect(screen.getByRole('link', { name: 'Movements' })).toHaveAttribute('href', '/en/m/inventory/stock/movements');
    expect(screen.getByRole('link', { name: 'Transfers' })).toHaveAttribute('href', '/en/m/inventory/stock/transfers');
    expect(screen.getByRole('link', { name: 'Reservations' })).toHaveAttribute(
      'href',
      '/en/m/inventory/stock/reservations',
    );
  });

  it('highlights the active stock sub-route (e.g. Reservations) nested under Stock', () => {
    pathname = '/en/m/inventory/stock/reservations';
    renderSidebar();

    // The Inventory module auto-expands; the nested child highlights because
    // it owns the active route (prefix match on its own href).
    expect(screen.getByRole('link', { name: 'Reservations' })).toHaveClass('bg-accent');
    // Stock still reads as the active section via the prefix match (like
    // /m/crm/deals/table highlights Deals) — the hierarchy is what changed.
    expect(screen.getByRole('link', { name: 'Stock' })).toHaveClass('bg-accent');
    // Sibling top-level items do NOT highlight — the route belongs to the
    // stock section, not to products or stock counts.
    expect(screen.getByRole('link', { name: 'Products' })).not.toHaveClass('bg-accent');
  });
});
