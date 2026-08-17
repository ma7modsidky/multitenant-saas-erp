// @vitest-environment jsdom
//
// Unit tests for the accounting reports hub (reports-view.tsx):
//   - The trial balance tab renders every account with totals and the
//     balanced badge (ACC-1).
//   - The income statement tab nets revenue against expenses (ACC-1).
//   - The AR aging tab renders open invoices bucketed by days past due
//     (ACC-8/ACC-9).
//   - The period filter re-queries with the selected date range.

import messages from '@modubiz/i18n/messages/en';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AccountingArAging,
  AccountingBalanceSheet,
  AccountingIncomeStatement,
  AccountingTrialBalance,
} from '@/lib/api/resources';

let trialBalance: AccountingTrialBalance;
let incomeStatement: AccountingIncomeStatement;
let balanceSheet: AccountingBalanceSheet;
let arAging: AccountingArAging;
const periodCalls: string[][] = [];

vi.mock('@/features/accounting/hooks', () => ({
  useAccountingTrialBalance: (period: { fromDate?: string; toDate?: string }) => {
    periodCalls.push([period.fromDate ?? '', period.toDate ?? '']);
    return { data: trialBalance, isPending: false, isError: false };
  },
  useAccountingIncomeStatement: () => ({ data: incomeStatement, isPending: false, isError: false }),
  useAccountingBalanceSheet: () => ({ data: balanceSheet, isPending: false, isError: false }),
  useAccountingArAging: () => ({ data: arAging, isPending: false, isError: false }),
  useCurrencies: () => ({ data: [{ code: 'USD', exponent: 2 }] }),
  useOrgBaseCurrency: () => 'USD',
}));

vi.mock('@/lib/entitlements', () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ReportsView } from '../reports-view';

function renderReports() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ReportsView />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  periodCalls.length = 0;
  trialBalance = {
    rows: [
      {
        accountId: 'acc-ar',
        code: '1200',
        nameI18n: { en: 'Accounts Receivable' },
        type: 'asset',
        isSystem: true,
        isActive: true,
        debitTotalMinor: '5000',
        creditTotalMinor: '2000',
        netMinor: '3000',
      },
      {
        accountId: 'acc-rev',
        code: '4000',
        nameI18n: { en: 'Revenue' },
        type: 'revenue',
        isSystem: true,
        isActive: true,
        debitTotalMinor: '0',
        creditTotalMinor: '5000',
        netMinor: '5000',
      },
    ],
    totals: { debitTotalMinor: '5000', creditTotalMinor: '5000' },
    balanced: true,
  };
  incomeStatement = {
    revenue: [{ accountId: 'acc-rev', code: '4000', nameI18n: { en: 'Revenue' }, netMinor: '5000' }],
    expenses: [{ accountId: 'acc-exp', code: '5000', nameI18n: { en: 'COGS' }, netMinor: '1200' }],
    revenueTotalMinor: '5000',
    expenseTotalMinor: '1200',
    netIncomeMinor: '3800',
  };
  balanceSheet = {
    asOfDate: '2026-08-15',
    assets: [{ accountId: 'acc-cash', code: '1000', nameI18n: { en: 'Cash' }, balanceMinor: '1100' }],
    liabilities: [{ accountId: 'acc-vat', code: '2100', nameI18n: { en: 'VAT payable' }, balanceMinor: '100' }],
    equity: [],
    assetTotalMinor: '1100',
    liabilityTotalMinor: '100',
    equityTotalMinor: '0',
  };
  arAging = {
    asOfDate: '2026-08-15',
    buckets: [
      {
        key: 'current',
        invoices: [
          {
            invoiceId: 'inv-1',
            invoiceNumber: 'INV-000001',
            customerName: 'Acme',
            invoiceDate: '2026-08-01',
            dueDate: '2026-08-20',
            currency: 'USD',
            balanceDueMinor: '10000',
            daysPastDue: 0,
          },
        ],
        totalMinor: '10000',
      },
      { key: '1_30', invoices: [], totalMinor: '0' },
      { key: '31_60', invoices: [], totalMinor: '0' },
      { key: '61_90', invoices: [], totalMinor: '0' },
      { key: '90_plus', invoices: [], totalMinor: '0' },
    ],
    totalOutstandingMinor: '10000',
  };
});

describe('ReportsView — trial balance (ACC-1)', () => {
  it('renders the default trial balance with account rows, totals, and the balanced badge', () => {
    renderReports();

    expect(screen.getByText('Accounts Receivable')).toBeTruthy();
    expect(screen.getByText('Revenue')).toBeTruthy();
    expect(screen.getByText('1200')).toBeTruthy();
    expect(screen.getByText('4000')).toBeTruthy();
    expect(screen.getByText('Balanced')).toBeTruthy();
  });

  it('applies the selected period filter and re-renders with the new data', async () => {
    const user = userEvent.setup();
    renderReports();

    // The initial load queries with no period.
    expect(periodCalls[0]).toEqual(['', '']);

    await user.click(screen.getByRole('button', { name: 'This month' }));
    expect(periodCalls.at(-1)![0]).not.toBe('');
    expect(periodCalls.at(-1)![1]).not.toBe('');

    // An unbalanced report shows the drift badge.
    trialBalance = { ...trialBalance, balanced: false, totals: { debitTotalMinor: '5000', creditTotalMinor: '4000' } };
    await user.click(screen.getByRole('button', { name: 'All time' }));
    await waitFor(() => expect(screen.getByText('Drift detected')).toBeTruthy());
  });
});

describe('ReportsView — income statement (ACC-1)', () => {
  it('renders revenue, expenses, and net income', async () => {
    const user = userEvent.setup();
    renderReports();

    await user.click(screen.getByRole('tab', { name: 'Income statement' }));

    expect(screen.getAllByText('Revenue').length).toBeGreaterThan(0);
    expect(screen.getByText('Expenses')).toBeTruthy();
    expect(screen.getByText('COGS')).toBeTruthy();
    expect(screen.getByText('Net income')).toBeTruthy();
    expect(screen.getByText('$38.00')).toBeTruthy();
  });
});

describe('ReportsView — AR aging (ACC-8/ACC-9)', () => {
  it('renders open invoices under the current bucket with the outstanding total', async () => {
    const user = userEvent.setup();
    renderReports();

    await user.click(screen.getByRole('tab', { name: 'AR aging' }));

    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getByText('INV-000001')).toBeTruthy();
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('Total outstanding')).toBeTruthy();
    // The bucket total and the invoice balance-due both render $100.00.
    expect(screen.getAllByText('$100.00').length).toBeGreaterThanOrEqual(2);
  });
});
