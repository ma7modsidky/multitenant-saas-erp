// @vitest-environment jsdom
//
// Regression test for the dashboard widget i18n keys. The widgets render the
// platform dashboard cards, so their empty states + "View all" links must
// resolve in the `dashboard.widgets.*` namespace for every locale (same
// failure mode as the CRM widgets — a MISSING_MESSAGE here broke the
// dashboard before).

import messages from '@modubiz/i18n/messages/en';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/features/inventory/hooks', () => ({
  // Both widgets render their empty state when the stock query resolves empty.
  useInventoryStock: () => ({ data: { items: [] }, isPending: false }),
  useCurrencies: () => ({ data: undefined }),
}));

import { InventoryLowStockWidget, InventoryStockValuationWidget } from '../dashboard-widgets';

function renderWidget(widget: React.ReactNode) {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      {widget}
    </NextIntlClientProvider>,
  );
}

describe('Inventory dashboard widgets — dashboard.widgets.* i18n keys resolve', () => {
  it('renders the low-stock empty state and the view-all link without MISSING_MESSAGE', () => {
    renderWidget(<InventoryLowStockWidget />);

    expect(screen.getByText('Stock levels look healthy — nothing is below its reorder point.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'View all' });
    expect(link).toHaveAttribute('href', '/en/m/inventory/stock');
  });

  it('renders the stock-valuation empty state and the view-all link without MISSING_MESSAGE', () => {
    renderWidget(<InventoryStockValuationWidget />);

    expect(screen.getByText('No valuation yet. Receive stock with a unit cost to see it here.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'View all' });
    expect(link).toHaveAttribute('href', '/en/m/inventory/stock');
  });
});
