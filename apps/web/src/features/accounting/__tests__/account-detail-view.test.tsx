// @vitest-environment jsdom
//
// Unit tests for the account detail / general-ledger view
// (account-detail-view.tsx):
//   - GL rows whose journal entry originates from an invoice issuance render a
//     direct "View invoice" link back to the source document (ACC-6/ACC-15).
//   - Rows from manual entries (or any non-invoice source) do not.
//   - Pagination controls render page N of M from the server-side page result.
//   - Export CSV downloads the current filtered GL page.

import messages from '@modubiz/i18n/messages/en';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false });
  const requestedPages: (number | undefined)[] = [];
  return {
    requestedPages,
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

let detail: {
  account: {
    id: string;
    code: string;
    nameI18n: Record<string, string>;
    type: string;
    isSystem: boolean;
    isActive: boolean;
  };
  balance: { debitTotal: string; creditTotal: string; netAmountMinor: string };
  movements: {
    items: {
      id: string;
      entryId: string;
      entryNumber: number;
      entryDate: string;
      description: string;
      status: string;
      postedAt: string | null;
      debitAmountMinor: string;
      creditAmountMinor: string;
      memo: string | null;
      sourceType: string;
      sourceId: string | null;
      runningBalanceMinor: string;
    }[];
    total: number;
    page: number;
    pageSize: number;
  };
};

vi.mock('@/features/accounting/hooks', () => ({
  // The mock returns the fixture's page/totals as-is; each test sets the
  // pagination state it wants rendered. It records requested pages so tests
  // can assert the view's pagination controls hit the hook with new pages.
  useAccountingAccount: (_id: string, params: { page?: number } = {}) => {
    h.requestedPages.push(params.page);
    return { data: detail, isPending: false, isError: false };
  },
  useAccountingCoa: () => ({ data: { items: [] }, isPending: false }),
  useAccountingMutations: () => h.mutations,
  useCurrencies: () => ({ data: [{ code: 'USD', exponent: 2 }] }),
  useOrgBaseCurrency: () => 'USD',
}));

vi.mock('@/lib/entitlements', () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useEntitlements: () => ({ data: undefined }),
}));

vi.mock('@/lib/permissions', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { AccountDetailView } from '../account-detail-view';

function renderDetail() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AccountDetailView id="acc-ar" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  detail = {
    account: {
      id: 'acc-ar',
      code: '1200',
      nameI18n: { en: 'Accounts Receivable' },
      type: 'asset',
      isSystem: true,
      isActive: true,
    },
    balance: { debitTotal: '1000', creditTotal: '0', netAmountMinor: '1000' },
    movements: {
      items: [
        {
          id: 'mv-1',
          entryId: 'entry-1',
          entryNumber: 3,
          entryDate: '2026-08-01',
          description: 'Invoice INV-0003 AR posting',
          status: 'posted',
          postedAt: '2026-08-01T10:00:00.000Z',
          debitAmountMinor: '1000',
          creditAmountMinor: '0',
          memo: null,
          sourceType: 'invoice_issuance',
          sourceId: 'inv-3',
          runningBalanceMinor: '1000',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    },
  };
});

describe('AccountDetailView — GL rows link to the source document (ACC-6/ACC-15)', () => {
  it('renders a View invoice link for movements from an invoice issuance', () => {
    renderDetail();

    expect(screen.getByText('Accounts Receivable')).toBeTruthy();
    expect(screen.getByText('JE-0003')).toBeTruthy();

    const invoiceLink = screen.getByRole('link', { name: 'View invoice' });
    expect(invoiceLink).toHaveAttribute('href', '/en/m/accounting/invoices/inv-3');
  });

  it('does not render a source link for manual (or non-invoice) movements', () => {
    detail.movements.items[0]!.sourceType = 'manual';
    detail.movements.items[0]!.sourceId = null;
    renderDetail();

    expect(screen.getByText('JE-0003')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View invoice' })).toBeNull();
  });
});

describe('AccountDetailView — pagination (server-side page result)', () => {
  it('renders the page indicator and enables Next when more pages exist', () => {
    detail.movements.total = 45;
    detail.movements.page = 1;
    renderDetail();

    expect(screen.getByText('Page 1 of 3')).toBeTruthy();

    const nextButton = screen.getByRole('button', { name: 'Next' });
    expect(nextButton).not.toBeDisabled();
  });

  it('disables the Previous button on the first page', () => {
    detail.movements.total = 45;
    detail.movements.page = 1;
    renderDetail();

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('requests the next page from the hook when Next is clicked', () => {
    h.requestedPages.length = 0;
    detail.movements.total = 45;
    detail.movements.page = 1;
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(h.requestedPages).toContain(2);
  });
});

describe('AccountDetailView — date-range filter + CSV export', () => {
  it('renders the from/to date inputs and Apply filter button', () => {
    renderDetail();

    expect(screen.getByLabelText('From date')).toBeTruthy();
    expect(screen.getByLabelText('To date')).toBeTruthy();

    const applyButton = screen.getByRole('button', { name: 'Apply' });
    expect(applyButton).toBeDisabled(); // disabled until a date is picked

    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-08-01' } });
    expect(applyButton).not.toBeDisabled();
  });

  it('downloads a CSV of the current GL page via the Export button', () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const click = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);

    try {
      renderDetail();
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('disables Export CSV when the GL page is empty', () => {
    detail.movements.items = [];
    detail.movements.total = 0;
    renderDetail();

    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    expect(screen.getByText('No transactions yet for this account.')).toBeTruthy();
  });
});
