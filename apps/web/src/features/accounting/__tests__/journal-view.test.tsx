// @vitest-environment jsdom
//
// Unit tests for the journal posting form (journal-view.tsx):
//   - The live totals footer shows Total Debit / Total Credit and turns red
//     (unbalanced hint) while the sides differ (ACC-1).
//   - The single-side rule: typing into one amount field clears the other on
//     the same line (ACC-4).
//   - The Post Entry button stays disabled until the entry is balanced AND has
//     at least two lines.

import messages from '@modubiz/i18n/messages/en';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountingAccount } from '@/lib/api/resources';

const h = vi.hoisted(() => {
  const mutation = () => ({
    mutateAsync: vi.fn().mockResolvedValue({ entryNumber: 1 }),
    isPending: false,
  });
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

let coa: { items: AccountingAccount[] };
let entries: {
  items: { id: string; entryNumber: number; entryDate: string; description: string; status: string }[];
  total?: number;
  page?: number;
  pageSize?: number;
};
let journalEntryDetail: {
  entry: {
    id: string;
    entryNumber: number;
    entryDate: string;
    description: string;
    status: string;
    currency: string;
    sourceType: string;
    sourceId: string | null;
    postedAt: string | null;
    createdAt: string;
    createdBy: string | null;
    postedBy: string | null;
    reversedBy: { id: string; entryNumber: number } | null;
    lines: {
      id: string;
      accountId: string;
      accountCode: string | null;
      accountNameI18n: Record<string, string> | null;
      debitAmountMinor: string;
      creditAmountMinor: string;
      memo: string | null;
    }[];
  };
};

let reversalDetail: typeof journalEntryDetail | undefined;
const h2 = vi.hoisted(() => {
  const requestedPages: (number | undefined)[] = [];
  return { requestedPages };
});

vi.mock('@/features/accounting/hooks', () => ({
  useAccountingCoa: () => ({ data: coa, isPending: false }),
  useAccountingJournal: (_filters: { page?: number } = {}) => {
    h2.requestedPages.push(_filters.page);
    // Echo the requested page so the rendered page indicator matches the
    // view's pagination state (mirrors the server's page result).
    return { data: { ...entries, page: _filters.page ?? entries.page }, isPending: false };
  },
  // The modal navigates to the reversing entry — return different detail per id.
  useAccountingJournalEntry: (id: string) => ({
    data: reversalDetail && id === reversalDetail.entry.id ? reversalDetail : journalEntryDetail,
    isPending: false,
    isError: false,
  }),
  useCurrencies: () => ({ data: [{ code: 'USD', exponent: 2 }] }),
  useOrgBaseCurrency: () => 'USD',
  useAccountingMutations: () => h.mutations,
}));

vi.mock('@/lib/hooks/use-member-name', () => ({
  useMemberName: () => (userId: string | null) => (userId === 'user-1' ? 'Amina Hassan' : null),
}));

vi.mock('@/lib/entitlements', () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useEntitlements: () => ({ data: undefined }),
}));

vi.mock('@/lib/permissions', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { JournalView } from '../journal-view';

const ACCOUNT: AccountingAccount = {
  id: 'acc-1',
  code: '1200',
  nameI18n: { en: 'Accounts Receivable' },
  type: 'asset',
  isSystem: true,
  isActive: true,
};

function renderJournal(initialEntryId: string | null = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <JournalView initialEntryId={initialEntryId} />
    </NextIntlClientProvider>,
  );
}

/** The manual entry form is collapsed by default — expand it first. */
async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'New entry' }));
}

beforeEach(() => {
  coa = { items: [ACCOUNT] };
  entries = { items: [] };
  journalEntryDetail = {
    entry: {
      id: 'entry-1',
      entryNumber: 7,
      entryDate: '2026-08-01',
      description: 'Invoice INV-0003 AR posting',
      status: 'posted',
      currency: 'USD',
      sourceType: 'invoice_issuance',
      sourceId: 'inv-3',
      postedAt: '2026-08-01T10:00:00.000Z',
      createdAt: '2026-08-01T10:00:00.000Z',
      createdBy: 'user-1',
      postedBy: 'user-1',
      reversedBy: null,
      lines: [
        {
          id: 'line-1',
          accountId: 'acc-1',
          accountCode: '1200',
          accountNameI18n: { en: 'Accounts Receivable' },
          debitAmountMinor: '50000',
          creditAmountMinor: '0',
          memo: 'AR for INV-0003',
        },
        {
          id: 'line-2',
          accountId: 'acc-2',
          accountCode: '4000',
          accountNameI18n: { en: 'Sales Revenue' },
          debitAmountMinor: '0',
          creditAmountMinor: '50000',
          memo: null,
        },
      ],
    },
  };
});

describe('JournalView — live balance validation (ACC-1/ACC-4)', () => {
  it('starts with two lines and the Post button disabled', async () => {
    const user = userEvent.setup();
    renderJournal();
    // The manual entry form is collapsed on load — expand it to post.
    await openForm(user);
    const post = screen.getByRole('button', { name: 'Post entry' });
    expect(post).toBeDisabled();
    // Balanced hint shows for a zero/empty entry (0 === 0), but the button
    // still requires amounts via the line-level refine.
    expect(screen.getByText(/Balanced — ready to post/)).toBeTruthy();
  });

  it('shows the live totals and an unbalanced hint while the sides differ', async () => {
    const user = userEvent.setup();
    renderJournal();
    await openForm(user);

    const debitInputs = screen.getAllByLabelText('Debit');
    const creditInputs = screen.getAllByLabelText('Credit');

    await user.type(debitInputs[0]!, '100');
    await user.type(creditInputs[1]!, '50');

    // Totals footer reflects the live sides.
    expect(screen.getByText('Total debit')).toBeTruthy();
    expect(screen.getByText('Total credit')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Unbalanced — difference/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Post entry' })).toBeDisabled();
  });

  it('clears the other side when one amount is typed on a line (ACC-4)', async () => {
    const user = userEvent.setup();
    renderJournal();
    await openForm(user);

    const debitInputs = screen.getAllByLabelText('Debit');
    const creditInputs = screen.getAllByLabelText('Credit');

    await user.type(debitInputs[0]!, '100');
    // eslint-disable-next-line no-restricted-syntax -- jsdom: read input values
    expect((debitInputs[0] as HTMLInputElement).value).toBe('100');
    // eslint-disable-next-line no-restricted-syntax -- jsdom: read input values
    expect((creditInputs[0] as HTMLInputElement).value).toBe('');

    // Typing a credit on the SAME line clears the debit (single-side rule).
    await user.type(creditInputs[0]!, '40');
    // eslint-disable-next-line no-restricted-syntax -- jsdom: read input values
    expect((creditInputs[0] as HTMLInputElement).value).toBe('40');
    // eslint-disable-next-line no-restricted-syntax -- jsdom: read input values
    expect((debitInputs[0] as HTMLInputElement).value).toBe('');
  });

  it('enables Post only when balanced with at least two lines', async () => {
    const user = userEvent.setup();
    renderJournal();
    await openForm(user);

    const debitInputs = screen.getAllByLabelText('Debit');
    const creditInputs = screen.getAllByLabelText('Credit');

    // 100 Dr on line 1, 100 Cr on line 2 → balanced, two lines → enabled.
    await user.type(debitInputs[0]!, '100');
    await user.type(creditInputs[1]!, '100');

    await waitFor(() => expect(screen.getByRole('button', { name: 'Post entry' })).toBeEnabled());
    expect(screen.getByText(/Balanced — ready to post/)).toBeTruthy();
  });
});

describe('JournalView — clickable entries open the detail modal', () => {
  it('opens the detail modal from the entry id and shows lines + actor metadata + source link', async () => {
    entries = {
      items: [
        {
          id: 'entry-1',
          entryNumber: 7,
          entryDate: '2026-08-01',
          description: 'Invoice INV-0003 AR posting',
          status: 'posted',
        },
      ],
      total: 1,
    };
    const user = userEvent.setup();
    renderJournal();

    // The entry reference is rendered as a clickable JE-0007 link.
    await user.click(screen.getByRole('button', { name: 'View entry details' }));

    // Modal header shows the formatted entry reference, not the raw UUID.
    expect(await screen.findByText('Journal entry #JE-0007')).toBeTruthy();
    expect(screen.getByText('1200')).toBeTruthy();
    expect(screen.getByText('Accounts Receivable')).toBeTruthy();
    expect(screen.getByText('AR for INV-0003')).toBeTruthy();
    expect(screen.getByText('Sales Revenue')).toBeTruthy();

    // Actor metadata — created/posted by the resolved member name.
    expect(screen.getAllByText('Amina Hassan').length).toBeGreaterThan(0);

    // Direct link to the source document (the invoice that produced the entry).
    const invoiceLink = screen.getByRole('link', { name: 'View invoice' });
    expect(invoiceLink).toHaveAttribute('href', '/en/m/accounting/invoices/inv-3');
  });

  it('opens the detail modal on load from a deep link entry id (invoice detail → journal)', async () => {
    entries = {
      items: [{ id: 'entry-1', entryNumber: 7, entryDate: '2026-08-01', description: 'Auto entry', status: 'posted' }],
      total: 1,
    };
    renderJournal('entry-1');

    // No click needed — the modal opens directly from the initial entry id.
    expect(await screen.findByText('Journal entry #JE-0007')).toBeTruthy();
    expect(screen.getByText('Accounts Receivable')).toBeTruthy();
  });

  it('shows a manual source label when the entry has no source document', async () => {
    journalEntryDetail.entry.sourceType = 'manual';
    journalEntryDetail.entry.sourceId = null;
    entries = {
      items: [
        {
          id: 'entry-1',
          entryNumber: 7,
          entryDate: '2026-08-01',
          description: 'Manual adjustment',
          status: 'posted',
        },
      ],
      total: 1,
    };
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole('button', { name: 'View entry details' }));

    expect(await screen.findByText('Journal entry #JE-0007')).toBeTruthy();
    expect(screen.getByText('Manual entry')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View invoice' })).toBeNull();
  });
});

describe('JournalView — modal system actors + reversal trail (ACC-2)', () => {
  function seedEntry(status: 'posted' | 'reversed' = 'posted') {
    entries = {
      items: [{ id: 'entry-1', entryNumber: 7, entryDate: '2026-08-01', description: 'Auto entry', status }],
      total: 1,
    };
  }

  it('labels null actors as System (Auto-generated) for auto-created entries', async () => {
    journalEntryDetail.entry.createdBy = null;
    journalEntryDetail.entry.postedBy = null;
    seedEntry();
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole('button', { name: 'View entry details' }));

    expect(await screen.findByText('Journal entry #JE-0007')).toBeTruthy();
    expect(screen.getAllByText('System (Auto-generated)')).toHaveLength(2);
  });

  it('links a reversed entry to its reversing entry and navigates the modal', async () => {
    journalEntryDetail.entry.status = 'reversed';
    journalEntryDetail.entry.reversedBy = { id: 'entry-2', entryNumber: 8 };
    reversalDetail = {
      entry: {
        ...journalEntryDetail.entry,
        id: 'entry-2',
        entryNumber: 8,
        status: 'posted',
        description: 'Reversal of entry-1',
        reversedBy: null,
      },
    };
    seedEntry('reversed');
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole('button', { name: 'View entry details' }));

    // The reversed entry shows a direct link to the reversing entry.
    const reversalLink = await screen.findByRole('button', { name: 'Open reversing entry JE-0008' });
    expect(reversalLink).toBeTruthy();
    expect(screen.getByText('Reversed by JE-0008')).toBeTruthy();

    // Clicking it swaps the modal content to the reversing entry.
    await user.click(reversalLink);
    expect(await screen.findByText('Journal entry #JE-0008')).toBeTruthy();
    expect(screen.getByText('Reversal of entry-1')).toBeTruthy();
  });
});

describe('JournalView — search + date filters above the ledger', () => {
  it('renders the filter bar and commits the search + date range on Apply', async () => {
    entries = {
      items: [
        { id: 'entry-1', entryNumber: 7, entryDate: '2026-08-01', description: 'Rent payment', status: 'posted' },
      ],
      total: 1,
    };
    const user = userEvent.setup();
    renderJournal();

    // The transaction history table is the primary focus on load.
    expect(screen.getByText('Rent payment')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Post entry' })).toBeNull();

    const searchInput = screen.getByLabelText('Search');
    await user.type(searchInput, 'Rent');
    await user.type(screen.getByLabelText('From date'), '2026-08-01');
    await user.type(screen.getByLabelText('To date'), '2026-08-31');

    // Apply is disabled until something is typed.
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    // A Clear button appears once filters are committed.
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
    // The ledger still renders the (mock) filtered row.
    expect(screen.getByText('Rent payment')).toBeTruthy();
  });

  it('clears the filters back to the unfiltered ledger', async () => {
    entries = {
      items: [
        { id: 'entry-1', entryNumber: 7, entryDate: '2026-08-01', description: 'Rent payment', status: 'posted' },
      ],
      total: 1,
    };
    const user = userEvent.setup();
    renderJournal();

    await user.type(screen.getByLabelText('Search'), 'Rent');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(screen.getByLabelText('Search')).toHaveValue('');
  });
});

describe('JournalView — ledger pagination', () => {
  function seedPage(page: number, total = 45) {
    entries = {
      items: [
        { id: 'entry-1', entryNumber: 7, entryDate: '2026-08-01', description: 'Rent payment', status: 'posted' },
      ],
      total,
      page,
      pageSize: 20,
    };
  }

  it('renders the page indicator + navigation buttons when the ledger spans pages', () => {
    seedPage(1);
    renderJournal();

    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect(screen.getByText('Showing 1 of 45 entries')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });

  it('requests the next page from the hook when Next is clicked', async () => {
    h2.requestedPages.length = 0;
    seedPage(1);
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(h2.requestedPages).toContain(2);
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  });

  it('disables Next on the last page', async () => {
    seedPage(1);
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Page 3 of 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
  });
});
