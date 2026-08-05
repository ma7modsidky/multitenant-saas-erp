// @vitest-environment jsdom
//
// Regression test for the dashboard widget i18n keys. The widgets render the
// platform dashboard cards, so their empty states + "View all" links must
// resolve in the `dashboard.widgets.*` namespace for every locale — a
// MISSING_MESSAGE here broke the dashboard before (keys had been placed at
// `dashboard.*` instead of `dashboard.widgets.*`).

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

vi.mock('@/features/crm/hooks', () => ({
  // Both widgets render their empty state when the list query resolves empty.
  useDealsList: () => ({ data: { items: [], total: 0 }, isPending: false }),
  useActivitiesList: () => ({ data: { items: [], total: 0 }, isPending: false }),
  useCurrencies: () => ({ data: undefined }),
}));

import { CrmRecentDealsWidget, CrmUpcomingActivitiesWidget } from '../dashboard-widgets';

function renderWidget(widget: React.ReactNode) {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      {widget}
    </NextIntlClientProvider>,
  );
}

describe('CRM dashboard widgets — dashboard.widgets.* i18n keys resolve', () => {
  it('renders the recent-deals empty state and the view-all link without MISSING_MESSAGE', () => {
    renderWidget(<CrmRecentDealsWidget />);

    expect(screen.getByText('No deals yet. Create your first deal in CRM.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'View all' });
    expect(link).toHaveAttribute('href', '/en/m/crm/deals');
  });

  it('renders the upcoming-activities empty state and the view-all link without MISSING_MESSAGE', () => {
    renderWidget(<CrmUpcomingActivitiesWidget />);

    expect(screen.getByText('Nothing due. Add activities in CRM to stay on top of follow-ups.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'View all' });
    expect(link).toHaveAttribute('href', '/en/m/crm/activities');
  });
});
