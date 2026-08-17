// @vitest-environment jsdom
//
// Unit tests for the invoice detail view (invoice-detail-view.tsx, ACC-6/9):
//   - Seller tax ID falls back to the org settings value when the invoice
//     snapshot is empty (ACC-6).
//   - '+ Pay' (Record Payment) renders only while money is actually owed.
//   - A View Journal Entry link jumps to the generated AR entry (ACC-6).

import messages from '@modubiz/i18n/messages/en';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountingInvoiceDetail } from '@/lib/api/resources';

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

let detail: AccountingInvoiceDetail;

const h2 = vi.hoisted(() => {
  const entry = {
    id: 'entry-9',
    entryNumber: 9,
    status: 'posted',
    entryDate: '2026-08-01',
    description: 'AR entry for INV-000001',
    createdAt: '2026-08-01T08:00:00.000Z',
    createdBy: null,
    postedAt: '2026-08-01T08:00:01.000Z',
    postedBy: null,
    sourceType: 'invoice_issuance',
    sourceId: 'inv-1',
    lines: [
      {
        id: 'jl-1',
        accountCode: '1100',
        accountNameI18n: { en: 'Accounts Receivable' },
        debitAmountMinor: '11500',
        creditAmountMinor: '0',
        memo: null,
      },
      {
        id: 'jl-2',
        accountCode: '4000',
        accountNameI18n: { en: 'Service Revenue' },
        debitAmountMinor: '0',
        creditAmountMinor: '11500',
        memo: null,
      },
    ],
  };
  return { entry };
});

vi.mock('@/features/accounting/hooks', () => ({
  useAccountingInvoice: () => ({ data: detail, isPending: false, isError: false }),
  useAccountingMutations: () => h.mutations,
  useAccountingJournalEntry: () => ({ data: { entry: h2.entry }, isPending: false, isError: false }),
  useCurrencies: () => ({ data: [{ code: 'USD', exponent: 2 }] }),
  useOrgBaseCurrency: () => 'USD',
}));

vi.mock('@/lib/hooks/use-member-name', () => ({
  useMemberName: () => () => null,
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

import { InvoiceDetailView } from '../invoice-detail-view';

function renderDetail() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <InvoiceDetailView id="inv-1" />
    </NextIntlClientProvider>,
  );
}

function seedInvoice(overrides: Partial<AccountingInvoiceDetail['invoice']> = {}) {
  detail = {
    invoice: {
      id: 'inv-1',
      invoiceNumber: 'INV-000001',
      customerNameSnapshot: 'Nile Traders',
      customerTaxIdSnapshot: 'TAX-123',
      sellerTaxId: null,
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
      createdAt: '2026-08-01T08:00:00.000Z',
      lines: [
        {
          id: 'line-1',
          itemNameSnapshot: 'Consulting',
          description: null,
          quantity: '1',
          unitPriceAmountMinor: '10000',
          discountAmountMinor: '0',
          taxRateBpSnapshot: 1500,
          taxTypeSnapshot: 'vat',
          taxAmountMinor: '1500',
          lineTotalAmountMinor: '11500',
        },
      ],
      ...overrides,
    },
    payments: [],
    creditNotes: [],
    orgSellerTaxId: null,
    journalEntry: { id: 'entry-9', entryNumber: 9 },
  };
}

beforeEach(() => {
  seedInvoice();
});

describe('InvoiceDetailView — seller tax fallback (ACC-6)', () => {
  it('shows the invoice snapshot when present', () => {
    seedInvoice({ sellerTaxId: 'INV-VAT-1' });
    renderDetail();

    expect(screen.getByText('INV-VAT-1')).toBeTruthy();
  });

  it('falls back to the org settings seller tax id when the snapshot is empty', () => {
    detail.orgSellerTaxId = 'ORG-VAT-999';
    renderDetail();

    expect(screen.getByText('ORG-VAT-999')).toBeTruthy();
  });
});

describe('InvoiceDetailView — Record Payment (ACC-9)', () => {
  it('renders the Pay button while a balance is due', () => {
    renderDetail();

    expect(screen.getByRole('button', { name: 'Pay' })).toBeTruthy();
  });

  it('hides Pay when the invoice is fully paid', () => {
    seedInvoice({ status: 'paid', paidAmountMinor: '11500' });
    renderDetail();

    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
  });

  it('hides Pay for a void invoice even with an unpaid balance', () => {
    seedInvoice({ status: 'void' });
    renderDetail();

    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
  });
});

describe('InvoiceDetailView — View Journal Entry (ACC-6)', () => {
  it('opens the GL entry detail modal in place (no navigation)', async () => {
    const user = (await import('@testing-library/user-event')).default;
    renderDetail();

    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'View journal entry JE-0009' }));

    // The modal shows the AR entry without leaving the invoice document.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(screen.getByText('Accounts Receivable')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View invoice' })).toHaveAttribute(
      'href',
      '/en/m/accounting/invoices/inv-1',
    );
  });

  it('renders no journal button when the invoice has no GL entry', () => {
    detail.journalEntry = null;
    renderDetail();

    expect(screen.queryByRole('button', { name: /View journal entry/ })).toBeNull();
  });
});
