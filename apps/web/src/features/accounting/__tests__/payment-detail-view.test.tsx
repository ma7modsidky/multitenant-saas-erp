// @vitest-environment jsdom
//
// Unit tests for the payment receipt detail view (payment-detail-view.tsx,
// ACC-9):
//   - Renders the receipt header: method, amount, reference, actor metadata.
//   - Renders the allocation breakdown with a link back to each invoice.
//   - Shows the allocated total footer and the fully-allocated badge.

import messages from '@modubiz/i18n/messages/en';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountingPaymentDetail } from '@/lib/api/resources';

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

let detail: AccountingPaymentDetail;

const h2 = vi.hoisted(() => {
  const entry = {
    id: 'entry-9',
    entryNumber: 9,
    status: 'posted',
    entryDate: '2026-08-06',
    description: 'Payment REC-000004',
    createdAt: '2026-08-06T08:01:00.000Z',
    createdBy: 'user-1',
    postedAt: '2026-08-06T08:01:00.000Z',
    postedBy: 'user-1',
    sourceType: 'payment',
    sourceId: 'pay-1',
    lines: [
      {
        id: 'jl-1',
        accountCode: '1100',
        accountNameI18n: { en: 'Bank' },
        debitAmountMinor: '6000',
        creditAmountMinor: '0',
        memo: null,
      },
      {
        id: 'jl-2',
        accountCode: '1200',
        accountNameI18n: { en: 'Accounts Receivable' },
        debitAmountMinor: '0',
        creditAmountMinor: '6000',
        memo: null,
      },
    ],
  };
  return { entry };
});

vi.mock('@/features/accounting/hooks', () => ({
  useAccountingPayment: () => ({ data: detail, isPending: false, isError: false }),
  useAccountingJournalEntry: () => ({ data: { entry: h2.entry }, isPending: false, isError: false }),
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

vi.mock('@/lib/hooks/use-member-name', () => ({
  useMemberName: () => (id: string | null) => (id === 'user-1' ? 'Amina Hassan' : null),
}));

import { PaymentDetailView } from '../payment-detail-view';

function renderDetail() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PaymentDetailView id="pay-1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  detail = {
    payment: {
      id: 'pay-1',
      method: 'bank_transfer',
      receiptNumber: 'REC-000004',
      amountMinor: '6000',
      currency: 'USD',
      receivedAt: '2026-08-06T08:00:00.000Z',
      reference: 'TXN-SPLIT',
      createdBy: 'user-1',
      createdAt: '2026-08-06T08:01:00.000Z',
    },
    allocations: [
      {
        id: 'al-1',
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-0001',
        customerNameSnapshot: 'Nile Traders',
        invoiceDate: '2026-08-01',
        invoiceStatus: 'issued',
        currency: 'USD',
        amountMinor: '4000',
      },
      {
        id: 'al-2',
        invoiceId: 'inv-2',
        invoiceNumber: 'INV-0002',
        customerNameSnapshot: 'Delta Supplies',
        invoiceDate: '2026-08-02',
        invoiceStatus: 'paid',
        currency: 'USD',
        amountMinor: '2000',
      },
    ],
    journalEntry: { id: 'entry-9', entryNumber: 9 },
  };
});

describe('PaymentDetailView (ACC-9) — receipt detail', () => {
  it('renders the structured receipt reference (REC-xxxxx) instead of the raw id', () => {
    renderDetail();

    // ACC-9: the header shows 'Payment receipt #REC-000004' — never the uuid.
    expect(screen.getByText('Payment receipt #REC-000004')).toBeTruthy();
    expect(screen.queryByText(/^pay-1/)).toBeNull();
  });

  it('renders the receipt header with method, amount, reference, and actor', () => {
    renderDetail();

    expect(screen.getByText('Payment receipt')).toBeTruthy();
    expect(screen.getByText('Bank transfer')).toBeTruthy();
    expect(screen.getAllByText('$60.00').length).toBeGreaterThan(0);
    expect(screen.getByText('TXN-SPLIT')).toBeTruthy();
    expect(screen.getByText('Amina Hassan')).toBeTruthy();
  });

  it('opens the receipt GL entry modal in place via View journal entry (ACC-9)', async () => {
    const user = (await import('@testing-library/user-event')).default;
    renderDetail();

    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'View journal entry JE-0009' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Print receipt' })).toBeTruthy();
  });

  it('hides the journal link when the receipt has no GL entry (POS path, ACC-13)', () => {
    detail.journalEntry = null;
    renderDetail();

    expect(screen.queryByRole('button', { name: /View journal entry/ })).toBeNull();
  });

  it('renders the allocation breakdown with invoice links and amounts', () => {
    renderDetail();

    expect(screen.getByText('Nile Traders')).toBeTruthy();
    expect(screen.getByText('Delta Supplies')).toBeTruthy();
    expect(screen.getByText('$40.00')).toBeTruthy();
    expect(screen.getByText('$20.00')).toBeTruthy();
    // Fully allocated footer: 4000 + 2000 = 6000 = receipt amount.
    expect(screen.getByText('Fully allocated')).toBeTruthy();
    expect(screen.getByText('Total allocated')).toBeTruthy();
    expect(screen.getAllByText('$60.00').length).toBeGreaterThan(0);

    const firstInvoice = screen.getByRole('link', { name: 'INV-0001' });
    expect(firstInvoice).toHaveAttribute('href', '/en/m/accounting/invoices/inv-1');
    const secondInvoice = screen.getByRole('link', { name: 'INV-0002' });
    expect(secondInvoice).toHaveAttribute('href', '/en/m/accounting/invoices/inv-2');
  });

  it('shows the partially-allocated badge when the sum of allocations is short', () => {
    detail.allocations[0]!.amountMinor = '3000';
    renderDetail();

    expect(screen.getByText('Partially allocated')).toBeTruthy();
  });

  it('renders the empty state when a receipt has no allocations', () => {
    detail.allocations = [];
    renderDetail();

    expect(screen.getByText('This receipt has no allocations.')).toBeTruthy();
    expect(screen.getByText('Partially allocated')).toBeTruthy();
  });
});
