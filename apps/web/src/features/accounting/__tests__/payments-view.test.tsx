// @vitest-environment jsdom
//
// Unit tests for the payments receipts view (payments-view.tsx, ACC-9):
//   - Renders each payment row: method badge, invoice link, customer, amount.
//   - The empty state renders when no receipts exist.
//   - Pagination controls render when the result spans multiple pages.

import messages from '@modubiz/i18n/messages/en';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountingPayment } from '@/lib/api/resources';

const h = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false });
  return {
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

let payments: { items: AccountingPayment[]; total: number; page: number; pageSize: number };

// Capture the filters the view commits to the payments hook (search/method/date).
const h2 = vi.hoisted(() => {
  const filters: Record<string, unknown> = {};
  return { filters };
});

vi.mock('@/features/accounting/hooks', () => ({
  useAccountingPayments: (filters: Record<string, unknown>) => {
    h2.filters = filters;
    return { data: payments, isPending: false };
  },
  useAccountingCoa: () => ({ data: { items: [] }, isPending: false }),
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

import { PaymentsView } from '../payments-view';

function renderPayments() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PaymentsView />
    </NextIntlClientProvider>,
  );
}

const RECEIPT: AccountingPayment = {
  id: 'pay-1',
  method: 'bank_transfer',
  receiptNumber: 'REC-000004',
  amountMinor: '2500',
  currency: 'USD',
  receivedAt: '2026-08-05T09:30:00.000Z',
  reference: 'TXN-88721',
  invoiceId: 'inv-7',
  invoiceNumber: 'INV-0007',
  customerNameSnapshot: 'Nile Traders',
  allocationAmountMinor: '2500',
};

beforeEach(() => {
  payments = { items: [RECEIPT], total: 1, page: 1, pageSize: 20 };
});

describe('PaymentsView (ACC-9) — receipts list', () => {
  it('renders each receipt with method, invoice link, customer, and amount', () => {
    renderPayments();

    expect(screen.getByText('Payments')).toBeTruthy();
    expect(screen.getByText('Bank transfer')).toBeTruthy();
    expect(screen.getByText('Nile Traders')).toBeTruthy();
    expect(screen.getByText('TXN-88721')).toBeTruthy();
    expect(screen.getByText('$25.00')).toBeTruthy();

    const invoiceLink = screen.getByRole('link', { name: 'INV-0007' });
    expect(invoiceLink).toHaveAttribute('href', '/en/m/accounting/invoices/inv-7');
  });

  it('renders the empty state when no receipts exist', () => {
    payments.items = [];
    payments.total = 0;
    renderPayments();

    expect(screen.getByText('No payments recorded yet.')).toBeTruthy();
  });

  it('renders pagination when the result spans multiple pages', () => {
    payments.total = 35;
    renderPayments();

    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    expect(screen.getByText('Showing 1–20 of 35 payments')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });

  it('commits the free-text search (customer/invoice) to the hook on Apply', async () => {
    const user = (await import('@testing-library/user-event')).default;
    renderPayments();

    await user.type(screen.getByLabelText('Search'), 'Nile');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(h2.filters.q).toBe('Nile');
    expect(h2.filters.page).toBe(1);
  });

  it('clears the search back to the unfiltered list', async () => {
    const user = (await import('@testing-library/user-event')).default;
    renderPayments();

    await user.type(screen.getByLabelText('Search'), 'Nile');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(h2.filters.q).toBeUndefined();
    expect(screen.getByLabelText('Search')).toHaveValue('');
  });
});
