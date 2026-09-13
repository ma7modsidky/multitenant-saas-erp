// @vitest-environment jsdom

import messages from '@modubiz/i18n/messages/en';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { ProductShowcase } from '../product-showcase';

const showcase = messages.landing.showcase;

function renderShowcase() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <ProductShowcase />
    </NextIntlClientProvider>,
  );
}

describe('ProductShowcase — hero dashboard mockup', () => {
  it('exposes an accessible name from the localized alt and hides decorative internals', () => {
    renderShowcase();

    const mockup = screen.getByRole('img', { name: showcase.alt });
    expect(mockup).toBeInTheDocument();
  });

  it('renders localized KPI, sidebar, and pipeline labels from the en catalog', () => {
    renderShowcase();

    expect(screen.getByText(showcase.kpi.revenue)).toBeInTheDocument();
    expect(screen.getByText(showcase.kpi.invoices)).toBeInTheDocument();
    expect(screen.getByText(showcase.nav.crm)).toBeInTheDocument();
    expect(screen.getByText(showcase.nav.inventory)).toBeInTheDocument();
    expect(screen.getByText(showcase.pipeline.title)).toBeInTheDocument();
    expect(screen.getByText(showcase.pipeline.winRate)).toBeInTheDocument();
    const stages: readonly (keyof typeof showcase.stage)[] = ['new', 'qualified', 'won'];
    for (const stage of stages) {
      expect(screen.getByText(showcase.stage[stage])).toBeInTheDocument();
    }
  });

  it('renders the CRM-17 stage success bars with the documented percentages', () => {
    renderShowcase();

    const bars = document.querySelectorAll<HTMLElement>('.bg-success[style]');
    expect(bars.length).toBe(3);
    expect(bars[0]?.style.width).toBe('45%');
    expect(bars[1]?.style.width).toBe('60%');
    expect(bars[2]?.style.width).toBe('100%');
  });
});
