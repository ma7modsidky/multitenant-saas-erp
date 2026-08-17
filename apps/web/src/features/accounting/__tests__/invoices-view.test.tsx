// @vitest-environment jsdom
//
// Unit tests for the invoices list view (invoices-view.tsx, ACC-6/8/9):
//   - The create-invoice form is collapsed by default — the AR table is the
//     primary focus; '+ Create invoice' expands it.
//   - Search (invoice number / customer) + status tabs filter the list.
//   - Pagination renders when the list spans multiple pages.
//   - Void invoices never render a Pay action (ACC-8).

import messages from '@modubiz/i18n/messages/en';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountingInvoice } from '@/lib/api/resources';

const h = vi.hoisted(() => {
  const mutation = () => ({
    mutateAsync: vi.fn().mockResolvedValue({ invoiceNumber: 'INV-000001' }),
    isPending: false,
  });
  const requestedFilters: Array<{ q?: string; status?: string; page?: number }> = [];
  return {
    requestedFilters,
    mutations: {
      createAccount: mutation(),
      updateAccount: mutation(),
      postJournalEntry: mutation(),
      reverseJournalEntry: mutation(),
      issueInvoice: mutation(),
      applyPayment: mutation(),
      issueCreditNote: mutation(),
    },
  };
});

let invoices: { items: AccountingInvoice[]; total: number; page: number; pageSize: number };

vi.mock('@/features/accounting/hooks', () => ({
  useAccountingInvoices: (filters: { q?: string; status?: string; page?: number } = {}) => {
    h.requestedFilters.push(filters);
    return { data: invoices, isPending: false };
  },
  useAccountingMutations: () => h.mutations,
  useCurrencies: () => ({ data: [{ code: 'USD', exponent: 2 }] }),
  useOrgBaseCurrency: () => 'USD',
}));

vi.mock('@/lib/entitlements', () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/permissions', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

import { InvoicesView } from '../invoices-view';

function renderInvoices() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <InvoicesView />
    </NextIntlClientProvider>,
  );
}

const RECEIPT: AccountingInvoice = {
  id: 'inv-1',
  invoiceNumber: 'INV-000001',
  customerNameSnapshot: 'Nile Traders',
  status: 'issued',
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-31',
  currency: 'USD',
  subtotalAmountMinor: '10000',
  discountAmountMinor: '0',
  taxAmountMinor: '1500',
  totalAmountMinor: '11500',
  paidAmountMinor: '0',
  creditedAmountMinor: '0',
  sourceType: null,
  sourceId: null,
};

beforeEach(() => {
  h.requestedFilters.length = 0;
  invoices = { items: [RECEIPT], total: 1, page: 1, pageSize: 20 };
});

describe('InvoicesView — table as primary focus (ACC-6/8)', () => {
  it('renders the table with the create form collapsed on load', () => {
    renderInvoices();

    expect(screen.getByText('Nile Traders')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create invoice' })).toBeTruthy();
    expect(screen.queryByLabelText('Customer')).toBeNull(); // form fields hidden
  });

  it('expands the create-invoice form via the toggle', async () => {
    const user = userEvent.setup();
    renderInvoices();

    await user.click(screen.getByRole('button', { name: 'Create invoice' }));
    expect(screen.getByLabelText('Customer')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Hide invoice form' }));
    expect(screen.queryByLabelText('Customer')).toBeNull();
  });
});

describe('InvoicesView — search + status filter + pagination', () => {
  it('commits the search query to the hook on Apply', async () => {
    const user = userEvent.setup();
    renderInvoices();

    await user.type(screen.getByLabelText('Search'), 'Nile');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(h.requestedFilters[h.requestedFilters.length - 1]?.q).toBe('Nile');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
  });

  it('filters by status via the Status dropdown', async () => {
    const user = userEvent.setup();
    renderInvoices();

    // The status filter is a dropdown (not tabs) — open it and pick Paid.
    await user.click(screen.getByLabelText('Status'));
    await user.click(screen.getByRole('option', { name: 'Paid' }));
    expect(h.requestedFilters[h.requestedFilters.length - 1]?.status).toBe('paid');
  });

  it('renders pagination when the list spans pages', () => {
    invoices = { items: [RECEIPT], total: 45, page: 1, pageSize: 20 };
    renderInvoices();

    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect(screen.getByText('Showing 1 of 45 invoices')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });
});

describe('InvoicesView — void invoices have no payment action (ACC-8)', () => {
  it('does not render the Pay button for a void invoice', () => {
    invoices = { items: [{ ...RECEIPT, status: 'void' }], total: 1, page: 1, pageSize: 20 };
    renderInvoices();

    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
  });

  it('renders Pay for an issued invoice with a balance due', () => {
    renderInvoices();

    expect(screen.getByRole('button', { name: 'Pay' })).toBeTruthy();
  });

  it('renders no Pay button for a paid invoice', () => {
    invoices = {
      items: [{ ...RECEIPT, status: 'paid', paidAmountMinor: '11500' }],
      total: 1,
      page: 1,
      pageSize: 20,
    };
    renderInvoices();

    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
  });
});
