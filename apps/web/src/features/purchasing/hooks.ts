'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  approvePurchasingBill,
  approvePurchasingPurchaseOrder,
  approvePurchasingReturn,
  createPurchasingBill,
  createPurchasingPurchaseOrder,
  createPurchasingReturn,
  createPurchasingSupplier,
  getPurchasingBill,
  getPurchasingBills,
  getPurchasingGrn,
  getPurchasingGrns,
  getPurchasingPayment,
  getPurchasingPayments,
  getPurchasingPurchaseOrder,
  getPurchasingPurchaseOrders,
  getPurchasingReturn,
  getPurchasingReturns,
  getPurchasingSupplier,
  getPurchasingSuppliers,
  getPurchasingVendorBalances,
  receivePurchasingGrn,
  recordPurchasingPayment,
  updatePurchasingSupplier,
  getActiveOrganization,
  getAccountingJournal,
  getCurrencies,
  type AccountingJournalEntry,
  type PurchasingBillParams,
  type PurchasingGrnParams,
  type PurchasingPaymentParams,
  type PurchasingPoParams,
  type PurchasingReturnParams,
  type PurchasingSupplierParams,
} from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';

/** Stable query-key namespace for the purchasing module (invalidation scope). */
const purchasingKey = (parts: string[]): string[] => ['purchasing', ...parts];

/** ISO currency reference data for the money fields. */
export function useCurrencies() {
  return useQuery({ queryKey: ['fx', 'currencies'], queryFn: getCurrencies });
}

/** The active organization (name, base currency) — shared with other modules. */
export function useActiveOrganization() {
  const { organizationId } = useSession();
  return useQuery({
    queryKey: ['organization', organizationId],
    queryFn: getActiveOrganization,
    enabled: organizationId !== null,
  });
}

/** Org base currency — the default for purchasing document currency fields. */
export function useOrgBaseCurrency(): string {
  const { data } = useActiveOrganization();
  return data?.data.baseCurrency ?? 'USD';
}

export function usePurchasingSuppliers(params: PurchasingSupplierParams = {}) {
  return useQuery({
    queryKey: purchasingKey(['suppliers', params.q ?? '', String(params.page ?? 1)]),
    queryFn: () => getPurchasingSuppliers(params),
    placeholderData: keepPreviousData,
  });
}

export function usePurchasingSupplier(id: string) {
  return useQuery({
    queryKey: purchasingKey(['suppliers', id]),
    queryFn: () => getPurchasingSupplier(id),
    enabled: id !== '',
  });
}

export function usePurchasingPurchaseOrders(params: PurchasingPoParams = {}) {
  return useQuery({
    queryKey: purchasingKey(['pos', params.q ?? '', params.status ?? '', String(params.page ?? 1)]),
    queryFn: () => getPurchasingPurchaseOrders(params),
    placeholderData: keepPreviousData,
  });
}

export function usePurchasingPurchaseOrder(id: string) {
  return useQuery({
    queryKey: purchasingKey(['pos', id]),
    queryFn: () => getPurchasingPurchaseOrder(id),
    enabled: id !== '',
  });
}

export function usePurchasingGrns(params: PurchasingGrnParams = {}) {
  return useQuery({
    queryKey: purchasingKey(['grns', params.q ?? '', params.supplierId ?? '', String(params.page ?? 1)]),
    queryFn: () => getPurchasingGrns(params),
    placeholderData: keepPreviousData,
  });
}

export function usePurchasingGrn(id: string) {
  return useQuery({
    queryKey: purchasingKey(['grns', id]),
    queryFn: () => getPurchasingGrn(id),
    enabled: id !== '',
  });
}

export function usePurchasingBills(params: PurchasingBillParams = {}) {
  return useQuery({
    queryKey: purchasingKey([
      'bills',
      params.q ?? '',
      params.status ?? '',
      params.supplierId ?? '',
      String(params.page ?? 1),
    ]),
    queryFn: () => getPurchasingBills(params),
    placeholderData: keepPreviousData,
  });
}

export function usePurchasingBill(id: string) {
  return useQuery({
    queryKey: purchasingKey(['bills', id]),
    queryFn: () => getPurchasingBill(id),
    enabled: id !== '',
  });
}

export function usePurchasingPayments(params: PurchasingPaymentParams = {}) {
  return useQuery({
    queryKey: purchasingKey(['payments', params.q ?? '', params.method ?? '', String(params.page ?? 1)]),
    queryFn: () => getPurchasingPayments(params),
    placeholderData: keepPreviousData,
  });
}

export function usePurchasingPayment(id: string) {
  return useQuery({
    queryKey: purchasingKey(['payments', id]),
    queryFn: () => getPurchasingPayment(id),
    enabled: id !== '',
  });
}

export function usePurchasingReturns(params: PurchasingReturnParams = {}) {
  return useQuery({
    queryKey: purchasingKey(['returns', params.q ?? '', String(params.page ?? 1)]),
    queryFn: () => getPurchasingReturns(params),
    placeholderData: keepPreviousData,
  });
}

export function usePurchasingReturn(id: string) {
  return useQuery({
    queryKey: purchasingKey(['returns', id]),
    queryFn: () => getPurchasingReturn(id),
    enabled: id !== '',
  });
}

/**
 * The journal entry accounting posted for a purchasing document (ACC-15) —
 * resolved via the accounting module's journal list filtered by source. Used
 * by the bill / payment detail "View journal entry" action.
 */
export function useAccountingJournalBySource(sourceType: string | null, sourceId: string | null) {
  return useQuery({
    queryKey: purchasingKey(['journal', sourceType ?? '', sourceId ?? '']),
    queryFn: () =>
      getAccountingJournal({
        sourceType: sourceType === null ? '' : sourceType,
        sourceId: sourceId === null ? '' : sourceId,
        pageSize: 1,
      }),
    enabled: sourceType !== null && sourceId !== null,
    select: (data): AccountingJournalEntry | undefined => data.items[0],
  });
}

export function usePurchasingVendorBalances() {
  return useQuery({
    queryKey: purchasingKey(['vendor-balances']),
    queryFn: getPurchasingVendorBalances,
  });
}

/** Mutations — every success invalidates the affected list/detail keys. */
export function usePurchasingMutations() {
  const queryClient = useQueryClient();
  // invalidateQueries returns a Promise — void it: fire-and-forget cache refresh
  // (the mutation's own result is already committed; no UI waits on this).
  const invalidate = (parts: string[]) => void queryClient.invalidateQueries({ queryKey: purchasingKey(parts) });

  return {
    createSupplier: useMutation({
      mutationFn: createPurchasingSupplier,
      onSuccess: () => invalidate(['suppliers']),
    }),
    updateSupplier: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updatePurchasingSupplier>[1] }) =>
        updatePurchasingSupplier(id, input),
      onSuccess: () => {
        invalidate(['suppliers']);
        invalidate(['vendor-balances']);
      },
    }),
    createPurchaseOrder: useMutation({
      mutationFn: createPurchasingPurchaseOrder,
      onSuccess: () => invalidate(['pos']),
    }),
    approvePurchaseOrder: useMutation({
      mutationFn: approvePurchasingPurchaseOrder,
      onSuccess: () => invalidate(['pos']),
    }),
    receiveGrn: useMutation({
      mutationFn: receivePurchasingGrn,
      onSuccess: () => {
        invalidate(['grns']);
        invalidate(['pos']);
      },
    }),
    createBill: useMutation({
      mutationFn: createPurchasingBill,
      onSuccess: () => invalidate(['bills']),
    }),
    approveBill: useMutation({
      mutationFn: ({ id, idempotencyKey }: { id: string; idempotencyKey?: string | null }) =>
        approvePurchasingBill(id, idempotencyKey),
      onSuccess: () => {
        invalidate(['bills']);
        invalidate(['vendor-balances']);
      },
    }),
    recordPayment: useMutation({
      mutationFn: recordPurchasingPayment,
      onSuccess: () => {
        invalidate(['payments']);
        invalidate(['bills']);
        invalidate(['vendor-balances']);
      },
    }),
    createReturn: useMutation({
      mutationFn: createPurchasingReturn,
      onSuccess: () => invalidate(['returns']),
    }),
    approveReturn: useMutation({
      mutationFn: ({ id, idempotencyKey }: { id: string; idempotencyKey?: string | null }) =>
        approvePurchasingReturn(id, idempotencyKey),
      onSuccess: () => {
        invalidate(['returns']);
        invalidate(['vendor-balances']);
      },
    }),
  };
}
