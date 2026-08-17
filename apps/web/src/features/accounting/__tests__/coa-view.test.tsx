// @vitest-environment jsdom
//
// Unit tests for the chart of accounts view (coa-view.tsx):
//   - The Add Account form rejects technical system keys (coa.bank) with a
//     plain-name hint (ACC-5).
//   - The code auto-generates for the selected account type (asset → 1xxx,
//     expense → 5xxx) and can be manually overridden.
//   - The ACTIONS column renders Edit + Deactivate for custom accounts and
//     nothing for immutable system accounts (ACC-5).

import messages from '@modubiz/i18n/messages/en';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountingAccount } from '@/lib/api/resources';

const h = vi.hoisted(() => {
  const mutation = () => ({
    mutateAsync: vi.fn().mockResolvedValue({ accountId: 'new-1', code: '5200' }),
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

vi.mock('@/features/accounting/hooks', () => ({
  useAccountingCoa: () => ({ data: coa, isPending: false }),
  useAccountingMutations: () => h.mutations,
}));

vi.mock('@/lib/entitlements', () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useEntitlements: () => ({
    data: {
      entitlements: [{ moduleKey: 'accounting', features: ['advanced_coa'] }],
    },
  }),
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

import { ChartOfAccountsView } from '../coa-view';

/** The seeded SME chart (ACC-5) — drives code auto-generation expectations. */
const SEEDED: AccountingAccount[] = [
  { id: 'a1', code: '1000', nameI18n: { en: 'coa.cash' }, type: 'asset', isSystem: true, isActive: true },
  { id: 'a2', code: '1100', nameI18n: { en: 'coa.bank' }, type: 'asset', isSystem: true, isActive: true },
  {
    id: 'a3',
    code: '1200',
    nameI18n: { en: 'coa.accounts_receivable' },
    type: 'asset',
    isSystem: true,
    isActive: true,
  },
  { id: 'a4', code: '1300', nameI18n: { en: 'coa.inventory' }, type: 'asset', isSystem: true, isActive: true },
  { id: 'a5', code: '4000', nameI18n: { en: 'coa.revenue' }, type: 'revenue', isSystem: true, isActive: true },
  { id: 'a6', code: '5000', nameI18n: { en: 'coa.cogs' }, type: 'expense', isSystem: true, isActive: true },
  {
    id: 'a7',
    code: '5100',
    nameI18n: { en: 'coa.operating_expense' },
    type: 'expense',
    isSystem: true,
    isActive: true,
  },
  {
    id: 'c1',
    code: '5200',
    nameI18n: { en: 'Software subscriptions' },
    type: 'expense',
    isSystem: false,
    isActive: true,
  },
];

function renderCoa() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ChartOfAccountsView />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  coa = { items: SEEDED };
});

describe('ChartOfAccountsView — Add Account form (ACC-5/ACC-16)', () => {
  it('renders the seeded chart with translated names and a custom account with actions', () => {
    renderCoa();
    // Seeded system account names resolve via the i18n catalog, not the raw key.
    expect(screen.getByText('Bank')).toBeTruthy();
    expect(screen.getByText('Software subscriptions')).toBeTruthy();

    const customRow = screen.getByText('Software subscriptions').closest('tr')!;
    expect(within(customRow).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(within(customRow).getByRole('button', { name: 'Deactivate account' })).toBeTruthy();

    // System rows have no actions (ACC-5 immutability).
    const systemRow = screen.getByText('Bank').closest('tr')!;
    expect(within(systemRow).queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('rejects a technical system key as the account name', async () => {
    const user = userEvent.setup();
    renderCoa();

    // The form is collapsed on load (table is the primary focus) — expand it.
    await user.click(screen.getByRole('button', { name: 'Add account' }));

    const nameInput = screen.getByLabelText('Name');
    await user.type(nameInput, 'coa.bank');

    await waitFor(() => expect(screen.getByText(/plain business name/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Add account' })).toBeDisabled();
  });

  it('auto-generates the next code in the selected type block', async () => {
    const user = userEvent.setup();
    renderCoa();

    // The form is collapsed on load (table is the primary focus) — expand it.
    await user.click(screen.getByRole('button', { name: 'Add account' }));

    // Default type is expense → next code after 5000/5100/5200 is 5300.
    const codeInput = screen.getByLabelText('Code');
    await waitFor(() =>
      // eslint-disable-next-line no-restricted-syntax -- jsdom: read the input's value
      expect((codeInput as HTMLInputElement).value).toBe('5300'),
    );

    // Switching to asset proposes 1400 (highest asset code 1300 + 100). The
    // type control is a custom popover select — click the trigger, then the
    // option.
    await user.click(screen.getByLabelText('Type'));
    await user.click(screen.getByRole('option', { name: 'Asset' }));
    await waitFor(() =>
      // eslint-disable-next-line no-restricted-syntax -- jsdom: read the input's value
      expect((codeInput as HTMLInputElement).value).toBe('1400'),
    );

    // A manual code override stops the auto-suggestion.
    await user.clear(codeInput);
    await user.type(codeInput, '1999');
    // eslint-disable-next-line no-restricted-syntax -- jsdom: read the input's value
    expect((codeInput as HTMLInputElement).value).toBe('1999');
  });
});

describe('ChartOfAccountsView — search + type filter', () => {
  it('filters accounts by name as the user types in the search bar', async () => {
    const user = userEvent.setup();
    renderCoa();

    // Full chart renders first.
    expect(screen.getByText('Bank')).toBeTruthy();
    expect(screen.getByText('Software subscriptions')).toBeTruthy();

    await user.type(screen.getByLabelText('Search accounts'), 'software');

    expect(screen.queryByText('Bank')).toBeNull();
    expect(screen.getByText('Software subscriptions')).toBeTruthy();
    expect(screen.getByText('Showing 1 of 8 accounts')).toBeTruthy();
  });

  it('filters accounts by code', async () => {
    const user = userEvent.setup();
    renderCoa();

    await user.type(screen.getByLabelText('Search accounts'), '4000');

    expect(screen.queryByText('Bank')).toBeNull();
    expect(screen.getAllByText('Revenue').length).toBeGreaterThan(0);
  });

  it('filters accounts by type via the Type select', async () => {
    const user = userEvent.setup();
    renderCoa();

    await user.click(screen.getByLabelText('Filter by type'));
    await user.click(screen.getByRole('option', { name: 'Expense' }));

    expect(screen.queryByText('Bank')).toBeNull();
    expect(screen.getByText('Cost of goods sold')).toBeTruthy();
    expect(screen.getByText('Software subscriptions')).toBeTruthy();
  });

  it('shows the no-matches state when filters exclude every account', async () => {
    const user = userEvent.setup();
    renderCoa();

    await user.type(screen.getByLabelText('Search accounts'), 'zzz-no-such-account');

    expect(screen.getByText('No accounts match your filters.')).toBeTruthy();
  });
});
