// @vitest-environment jsdom
//
// Unit tests for the credit-note detail view (credit-note-detail-view.tsx,
// ACC-10):
//   - Renders the document: customer, linked original invoice, reason, lines.
//   - Opens the reversal journal entry modal in place.
//   - Renders Print + Export PDF actions.

import messages from '@modubiz/i18n/messages/en';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountingCreditNoteDetail } from '@/lib/api/resources';

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

let detail: AccountingCreditNoteDetail;

const h2 = vi.hoisted(() => {
  const entry = {
    id: 'entry-9',
    entryNumber: 9,
    status: 'posted',
    entryDate: '2026-08-03',
    description: 'Credit note CN-000001',
    createdAt: '2026-08-03T09:00:00.000Z',
    createdBy: 'user-1',
    postedAt: '2026-08-03T09:00:01.000Z',
    postedBy: 'user-1',
    sourceType: 'credit_note',
    sourceId: 'cn-1',
    lines: [
      {
        id: 'jl-1',
        accountCode: '4000',
        accountNameI18n: { en: 'Service Revenue' },
        debitAmountMinor: '3000',
        creditAmountMinor: '0',
        memo: null,
      },
      {
        id: 'jl-2',
        accountCode: '1200',
        accountNameI18n: { en: 'Accounts Receivable' },
        debitAmountMinor: '0',
        creditAmountMinor: '3000',
        memo: null,
      },
    ],
  };
  return { entry };
});

vi.mock('@/features/accounting/hooks', () => ({
  useAccountingCreditNote: () => ({ data: detail, isPending: false, isError: false }),
  useAccountingJournalEntry: () => ({ data: { entry: h2.entry }, isPending: false, isError: false }),
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

vi.mock('@/lib/hooks/use-member-name', () => ({
  useMemberName: () => (id: string | null) => (id === 'user-1' ? 'Amina Hassan' : null),
}));

import { CreditNoteDetailView } from '../credit-note-detail-view';

function renderDetail() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CreditNoteDetailView id="cn-1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  detail = {
    creditNote: {
      id: 'cn-1',
      creditNoteNumber: 'CN-000001',
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-0001',
      customerNameSnapshot: 'Nile Traders',
      status: 'issued',
      reasonCode: 'CUSTOMER_RETURN',
      amountMinor: '3000',
      currency: 'USD',
      issuedAt: '2026-08-03T09:00:00.000Z',
      createdAt: '2026-08-03T09:00:00.000Z',
      lines: [
        {
          id: 'cnl-1',
          invoiceLineId: 'il-1',
          itemNameSnapshot: 'Consulting',
          quantity: '1',
          unitPriceAmountMinor: '3000',
          taxAmountMinor: '0',
          lineTotalAmountMinor: '3000',
        },
      ],
    },
    journalEntry: { id: 'entry-9', entryNumber: 9 },
  };
});

describe('CreditNoteDetailView (ACC-10) — credit-note document', () => {
  it('renders the document header with the linked original invoice and reason', () => {
    renderDetail();

    expect(screen.getByText('CN-000001')).toBeTruthy();
    expect(screen.getByText('Nile Traders')).toBeTruthy();
    expect(screen.getByText('CUSTOMER_RETURN')).toBeTruthy();
    expect(screen.getByText('Consulting')).toBeTruthy();
    // Unit price + line total + the credited footer all render the amount.
    expect(screen.getAllByText('$30.00').length).toBeGreaterThanOrEqual(2);

    const invoiceLink = screen.getByRole('link', { name: 'INV-0001' });
    expect(invoiceLink).toHaveAttribute('href', '/en/m/accounting/invoices/inv-1');
  });

  it('renders Print + Export PDF actions', () => {
    renderDetail();

    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeTruthy();
  });

  it('opens the reversal journal entry modal in place (ACC-10)', async () => {
    const user = (await import('@testing-library/user-event')).default;
    renderDetail();

    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'View journal entry JE-0009' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(screen.getByText('Accounts Receivable')).toBeTruthy();
  });

  it('hides the journal link when the note has no GL entry', () => {
    detail.journalEntry = null;
    renderDetail();

    expect(screen.queryByRole('button', { name: /View journal entry/ })).toBeNull();
  });
});
