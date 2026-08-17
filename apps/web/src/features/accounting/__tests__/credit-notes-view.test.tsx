// @vitest-environment jsdom
//
// Unit tests for the credit-notes reversal trail (credit-notes-view.tsx,
// ACC-10):
//   - Renders each credit note: number, linked invoice, customer, reason.
//   - Free-text search commits to the hook on Apply and clears.
//   - Pagination renders when the result spans multiple pages.

import messages from '@modubiz/i18n/messages/en';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountingCreditNote } from '@/lib/api/resources';

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

let notes: { items: AccountingCreditNote[]; total: number; page: number; pageSize: number };
const h2 = vi.hoisted(() => {
  const filters: Record<string, unknown> = {};
  return { filters };
});

vi.mock('@/features/accounting/hooks', () => ({
  useAccountingCreditNotes: (filters: Record<string, unknown>) => {
    h2.filters = filters;
    return { data: notes, isPending: false };
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

import { CreditNotesView } from '../credit-notes-view';

function renderCreditNotes() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CreditNotesView />
    </NextIntlClientProvider>,
  );
}

const NOTE: AccountingCreditNote = {
  id: 'cn-1',
  creditNoteNumber: 'CN-000001',
  invoiceId: 'inv-1',
  invoiceNumber: 'INV-0001',
  customerNameSnapshot: 'Nile Traders',
  status: 'issued',
  reasonCode: 'PARTIAL_REFUND',
  amountMinor: '3000',
  currency: 'USD',
  issuedAt: '2026-08-03T09:00:00.000Z',
  createdAt: '2026-08-03T09:00:00.000Z',
};

beforeEach(() => {
  notes = { items: [NOTE], total: 1, page: 1, pageSize: 20 };
});

describe('CreditNotesView (ACC-10) — reversal trail', () => {
  it('renders each note with its number, linked invoice, customer, and reason', () => {
    renderCreditNotes();

    expect(screen.getByText('Credit notes')).toBeTruthy();
    expect(screen.getByText('CN-000001')).toBeTruthy();
    expect(screen.getByText('Nile Traders')).toBeTruthy();
    expect(screen.getByText('PARTIAL_REFUND')).toBeTruthy();
    expect(screen.getByText('$30.00')).toBeTruthy();

    const invoiceLink = screen.getByRole('link', { name: 'INV-0001' });
    expect(invoiceLink).toHaveAttribute('href', '/en/m/accounting/invoices/inv-1');
    const viewLink = screen.getByRole('link', { name: 'View' });
    expect(viewLink).toHaveAttribute('href', '/en/m/accounting/credit-notes/cn-1');
  });

  it('renders the empty state when no credit notes exist', () => {
    notes.items = [];
    notes.total = 0;
    renderCreditNotes();

    expect(screen.getByText(/No credit notes yet/)).toBeTruthy();
  });

  it('commits the search to the hook on Apply and clears it back', async () => {
    const user = (await import('@testing-library/user-event')).default;
    renderCreditNotes();

    await user.type(screen.getByLabelText('Search'), 'nile');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(h2.filters.q).toBe('nile');
    expect(h2.filters.page).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(h2.filters.q).toBeUndefined();
    expect(screen.getByLabelText('Search')).toHaveValue('');
  });

  it('renders pagination when the result spans multiple pages', () => {
    notes.total = 35;
    renderCreditNotes();

    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    expect(screen.getByText('Showing 1–20 of 35 credit notes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });
});
