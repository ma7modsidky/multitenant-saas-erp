'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  applyAccountingPayment,
  createAccountingAccount,
  getAccountingAccount,
  getAccountingArAging,
  getAccountingBalanceSheet,
  getAccountingCoa,
  getAccountingIncomeStatement,
  getAccountingInvoice,
  getAccountingInvoices,
  getAccountingCreditNote,
  getAccountingCreditNotes,
  getAccountingJournal,
  getAccountingJournalEntry,
  getAccountingPayment,
  getAccountingPayments,
  getAccountingTrialBalance,
  issueAccountingCreditNote,
  issueAccountingInvoice,
  postAccountingJournalEntry,
  reverseAccountingJournalEntry,
  updateAccountingAccount,
  type AccountingAccountMovementsParams,
  type AccountingCreditNoteParams,
  type AccountingInvoiceParams,
  type AccountingJournalParams,
  type AccountingPaymentParams,
  type AccountingReportPeriod,
  getActiveOrganization,
  getCurrencies,
} from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';

/** Stable query-key namespace for the accounting module (invalidation scope). */
const accountingKey = (parts: string[]): string[] => ['accounting', ...parts];

/** ISO currency reference data for the money fields. */
export function useCurrencies() {
  return useQuery({ queryKey: ['fx', 'currencies'], queryFn: getCurrencies });
}

/** The active organization (name, base currency) — shared with POS pages. */
export function useActiveOrganization() {
  const { organizationId } = useSession();
  return useQuery({
    queryKey: ['organization', organizationId],
    queryFn: getActiveOrganization,
    enabled: organizationId !== null,
  });
}

/** Org base currency — the default for journal / invoice currency fields. */
export function useOrgBaseCurrency(): string {
  const { data } = useActiveOrganization();
  return data?.data.baseCurrency ?? 'USD';
}

/** Chart of accounts — ACC-5 lazy-ensures the default SME chart on first read. */
export function useAccountingCoa() {
  return useQuery({
    queryKey: accountingKey(['coa']),
    queryFn: getAccountingCoa,
    placeholderData: keepPreviousData,
  });
}

/** Account detail — header, balance, and paginated/filtered GL history (ACC-5). */
export function useAccountingAccount(id: string, params: AccountingAccountMovementsParams = {}) {
  return useQuery({
    queryKey: accountingKey([
      'coa',
      id,
      params.fromDate ?? '',
      params.toDate ?? '',
      String(params.page ?? 1),
      String(params.pageSize ?? 20),
    ]),
    queryFn: () => getAccountingAccount(id, params),
    enabled: id.length > 0,
    placeholderData: keepPreviousData,
  });
}

/** Payments list — every receipt with its invoice, newest first (ACC-9). */
export function useAccountingPayments(filters: AccountingPaymentParams = {}) {
  return useQuery({
    queryKey: accountingKey([
      'payments',
      filters.q ?? '',
      filters.method ?? '',
      filters.fromDate ?? '',
      filters.toDate ?? '',
      String(filters.page ?? 1),
      String(filters.pageSize ?? 20),
    ]),
    queryFn: () => getAccountingPayments(filters),
    placeholderData: keepPreviousData,
  });
}

/** Credit-notes list — the reversal trail with its invoice + customer (ACC-10). */
export function useAccountingCreditNotes(filters: AccountingCreditNoteParams = {}) {
  return useQuery({
    queryKey: accountingKey([
      'credit-notes',
      filters.q ?? '',
      String(filters.page ?? 1),
      String(filters.pageSize ?? 20),
    ]),
    queryFn: () => getAccountingCreditNotes(filters),
    placeholderData: keepPreviousData,
  });
}

/** One credit note with its reversed lines + the reversal entry (ACC-10). */
export function useAccountingCreditNote(id: string) {
  return useQuery({
    queryKey: accountingKey(['credit-notes', id]),
    queryFn: () => getAccountingCreditNote(id),
    enabled: id.length > 0,
  });
}

/** Payment receipt detail — header + allocation breakdown (ACC-9). */
export function useAccountingPayment(id: string) {
  return useQuery({
    queryKey: accountingKey(['payments', id]),
    queryFn: () => getAccountingPayment(id),
    enabled: id.length > 0,
  });
}

/** Invoice detail — header, lines, payments, and credit notes (ACC-6/9/10). */
export function useAccountingInvoice(id: string) {
  return useQuery({
    queryKey: accountingKey(['invoices', id]),
    queryFn: () => getAccountingInvoice(id),
    enabled: id.length > 0,
  });
}

export function useAccountingJournal(filters: AccountingJournalParams = {}) {
  return useQuery({
    queryKey: accountingKey([
      'journal',
      filters.q ?? '',
      filters.fromDate ?? '',
      filters.toDate ?? '',
      String(filters.page ?? 1),
      String(filters.pageSize ?? 12),
    ]),
    queryFn: () => getAccountingJournal(filters),
    placeholderData: keepPreviousData,
  });
}

/** One journal entry with its resolved lines + actor metadata (detail modal). */
export function useAccountingJournalEntry(id: string) {
  return useQuery({
    queryKey: accountingKey(['journal', 'entry', id]),
    queryFn: () => getAccountingJournalEntry(id),
    enabled: id.length > 0,
  });
}

// ─── Reports (ACC-1/ACC-8/ACC-9) ─────────────────────────────────────────

/** Trial balance over a period (all-time when no range). */
export function useAccountingTrialBalance(period: AccountingReportPeriod = {}) {
  return useQuery({
    queryKey: accountingKey(['reports', 'trial-balance', period.fromDate ?? '', period.toDate ?? '']),
    queryFn: () => getAccountingTrialBalance(period),
    placeholderData: keepPreviousData,
  });
}

/** Income statement over a period (all-time when no range). */
export function useAccountingIncomeStatement(period: AccountingReportPeriod = {}) {
  return useQuery({
    queryKey: accountingKey(['reports', 'income-statement', period.fromDate ?? '', period.toDate ?? '']),
    queryFn: () => getAccountingIncomeStatement(period),
    placeholderData: keepPreviousData,
  });
}

/** Balance sheet as of a date (default: today). */
export function useAccountingBalanceSheet(asOfDate?: string) {
  return useQuery({
    queryKey: accountingKey(['reports', 'balance-sheet', asOfDate ?? '']),
    queryFn: () => getAccountingBalanceSheet(asOfDate),
    placeholderData: keepPreviousData,
  });
}

/** AR aging as of a date (default: today). */
export function useAccountingArAging(asOfDate?: string) {
  return useQuery({
    queryKey: accountingKey(['reports', 'ar-aging', asOfDate ?? '']),
    queryFn: () => getAccountingArAging(asOfDate),
    placeholderData: keepPreviousData,
  });
}

export function useAccountingInvoices(filters: AccountingInvoiceParams = {}) {
  return useQuery({
    queryKey: accountingKey([
      'invoices',
      filters.q ?? '',
      filters.status ?? '',
      filters.fromDate ?? '',
      filters.toDate ?? '',
      String(filters.page ?? 1),
      String(filters.pageSize ?? 12),
    ]),
    queryFn: () => getAccountingInvoices(filters),
    placeholderData: keepPreviousData,
  });
}

/** Accounting mutations. Every mutation invalidates the `['accounting']` scope. */
export function useAccountingMutations() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ['accounting'] });
  return {
    createAccount: useMutation({ mutationFn: createAccountingAccount, onSuccess: invalidate }),
    updateAccount: useMutation({
      mutationFn: (input: { accountId: string; name?: string; isActive?: boolean }) =>
        updateAccountingAccount(input.accountId, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        }),
      onSuccess: invalidate,
    }),
    postJournalEntry: useMutation({ mutationFn: postAccountingJournalEntry, onSuccess: invalidate }),
    reverseJournalEntry: useMutation({
      mutationFn: (entryId: string) => reverseAccountingJournalEntry(entryId),
      onSuccess: invalidate,
    }),
    issueInvoice: useMutation({ mutationFn: issueAccountingInvoice, onSuccess: invalidate }),
    applyPayment: useMutation({ mutationFn: applyAccountingPayment, onSuccess: invalidate }),
    issueCreditNote: useMutation({ mutationFn: issueAccountingCreditNote, onSuccess: invalidate }),
  };
}
