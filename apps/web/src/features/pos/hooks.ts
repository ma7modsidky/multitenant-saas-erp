'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  closePosShift,
  createPosRegister,
  createPosRefund,
  createPosSale,
  getActiveOrganization,
  getCurrencies,
  getInventoryProducts,
  getPosRegisters,
  getPosSale,
  getPosSales,
  getPosShiftReport,
  getPosShifts,
  openPosShift,
  voidPosSale,
  type PosSaleParams,
} from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';

/** Stable query-key namespace for the POS module (invalidation scope). */
const posKey = (parts: string[]): string[] => ['pos', ...parts];

/** Stable key for a filtered sales list (cache + invalidation). */
function salesKey(filters: PosSaleParams = {}): string[] {
  return [
    'pos',
    'sales',
    filters.status ?? '',
    filters.shiftId ?? '',
    String(filters.page ?? 1),
    String(filters.pageSize ?? 12),
  ];
}

export function usePosRegisters() {
  return useQuery({ queryKey: posKey(['registers']), queryFn: getPosRegisters });
}

export function usePosShifts() {
  return useQuery({ queryKey: posKey(['shifts']), queryFn: getPosShifts });
}

export function usePosShiftReport(shiftId: string, enabled = true) {
  return useQuery({
    queryKey: posKey(['shifts', shiftId, 'report']),
    queryFn: () => getPosShiftReport(shiftId),
    enabled,
  });
}

export function usePosSale(id: string, enabled = true) {
  return useQuery({
    queryKey: posKey(['sales', id]),
    queryFn: () => getPosSale(id),
    enabled,
  });
}

export function usePosSales(filters: PosSaleParams = {}) {
  return useQuery({
    queryKey: salesKey(filters),
    queryFn: () => getPosSales(filters),
    placeholderData: keepPreviousData,
  });
}

/**
 * Sellable catalog for the checkout picker — the products list carries EVERY
 * variant with its price (grouped response), so the cart can snapshot price +
 * name at sale time (POS-12). Fetched at `pageSize: 100` (the full catalog
 * pattern used by the inventory stock-counts picker) so multi-page catalogs
 * are not silently truncated to the 12-row default.
 *
 * The key deliberately lives under the shared `['inventory']` scope so
 * inventory mutations (new product, archive, price edit) invalidate it too —
 * the POS catalog is just a different view of the same products data.
 */
export function usePosCatalog() {
  return useQuery({
    queryKey: ['inventory', 'products', 'pos-catalog'],
    queryFn: () => getInventoryProducts({ pageSize: 100 }),
    placeholderData: keepPreviousData,
  });
}

/** ISO currency reference data (`/v1/currencies`) for the money fields. */
export function useCurrencies() {
  return useQuery({ queryKey: ['fx', 'currencies'], queryFn: getCurrencies });
}

/** Org base currency — the default for register float / cart currency. */
export function useOrgBaseCurrency(): string {
  const { organizationId } = useSession();
  const { data } = useQuery({
    queryKey: ['organization', organizationId],
    queryFn: getActiveOrganization,
    enabled: organizationId !== null,
  });
  return data?.data.baseCurrency ?? 'USD';
}

/**
 * POS mutations. Every mutation invalidates the `['pos']` scope; sale-scoped
 * ones also invalidate the affected sale detail so the page refetches in place
 * (status flips after void/refund, per POS-13).
 */
export function usePosMutations() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ['pos'] });
  const invalidateSale = (saleId: string) =>
    Promise.all([invalidate(), client.invalidateQueries({ queryKey: posKey(['sales', saleId]) })]);
  return {
    createRegister: useMutation({ mutationFn: createPosRegister, onSuccess: invalidate }),
    openShift: useMutation({
      mutationFn: ({ registerId, ...input }: { registerId: string } & Parameters<typeof openPosShift>[1]) =>
        openPosShift(registerId, input),
      onSuccess: invalidate,
    }),
    closeShift: useMutation({
      mutationFn: ({ registerId, ...input }: { registerId: string } & Parameters<typeof closePosShift>[1]) =>
        closePosShift(registerId, input),
      onSuccess: invalidate,
    }),
    checkout: useMutation({ mutationFn: createPosSale, onSuccess: invalidate }),
    voidSale: useMutation({
      mutationFn: (saleId: string) => voidPosSale(saleId).then(() => saleId),
      onSuccess: (saleId) => void invalidateSale(saleId),
    }),
    refund: useMutation({
      mutationFn: createPosRefund,
      onSuccess: (_result, variables) => void invalidateSale(variables.originalSaleId),
    }),
  };
}
