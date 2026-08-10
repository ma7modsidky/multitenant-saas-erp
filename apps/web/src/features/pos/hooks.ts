'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api';
import {
  closePosShift,
  createPosRegister,
  createPosRefund,
  createPosSale,
  getActiveOrganization,
  getCrmContact,
  getCrmContacts,
  getCurrencies,
  getInventoryProducts,
  getPosRegisters,
  getPosSale,
  getPosSales,
  getPosShiftReport,
  getPosShifts,
  type PosShiftParams,
  openPosShift,
  voidPosSale,
  type PosSaleParams,
} from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';

import { cacheRegisters, cacheSellableCatalog, readCachedCatalog, readCachedRegisters } from './offline/cache';

/** Stable query-key namespace for the POS module (invalidation scope). */
const posKey = (parts: string[]): string[] => ['pos', ...parts];

/** Stable key for a filtered sales list (cache + invalidation). */
function salesKey(filters: PosSaleParams = {}): string[] {
  return [
    'pos',
    'sales',
    filters.status ?? '',
    filters.shiftId ?? '',
    filters.fromDate ?? '',
    filters.toDate ?? '',
    String(filters.page ?? 1),
    String(filters.pageSize ?? 12),
  ];
}

export function usePosRegisters() {
  const { organizationId } = useSession();
  return useQuery({
    queryKey: posKey(['registers']),
    queryFn: async () => {
      try {
        const data = await getPosRegisters();
        // POS-31 write-through: keep the last-known registers (incl. open-shift
        // ids) so selling can continue offline on a register that was open.
        if (organizationId) void cacheRegisters(organizationId, data.items);
        return data;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'NETWORK_ERROR' && organizationId) {
          const cached = await readCachedRegisters(organizationId);
          if (cached) return { items: cached };
        }
        throw err;
      }
    },
    placeholderData: keepPreviousData,
  });
}

export function usePosShifts(filters: PosShiftParams = {}) {
  return useQuery({
    queryKey: posKey(['shifts', filters.fromDate ?? '', filters.toDate ?? '']),
    queryFn: () => getPosShifts(filters),
  });
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

export function usePosSales(filters: PosSaleParams = {}, enabled = true) {
  return useQuery({
    queryKey: salesKey(filters),
    queryFn: () => getPosSales(filters),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * Contacts for the checkout customer picker (POS-18). Consumed from the CRM
 * module's list endpoint; degrades to an empty list when the org has no CRM
 * entitlement, so a POS-only org still gets the (optional) picker — it just
 * shows no customers.
 */
export function usePosContacts() {
  return useQuery({
    queryKey: posKey(['contacts']),
    queryFn: async () => {
      try {
        const page = await getCrmContacts({ pageSize: 50 });
        return page.items;
      } catch {
        // CRM may not be entitled — the picker degrades to an empty list.
        return [];
      }
    },
    placeholderData: keepPreviousData,
  });
}

/** Contact detail for the sale page — enabled only when the sale links one. */
export function usePosContact(id: string | null, enabled = true) {
  return useQuery({
    queryKey: posKey(['contacts', id ?? 'none']),
    queryFn: () => {
      // The query is disabled without an id; the explicit branch keeps the
      // type narrow without an `as` cast.
      if (id === null) return Promise.resolve(null);
      return getCrmContact(id);
    },
    enabled: enabled && id !== null,
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
  const { organizationId } = useSession();
  return useQuery({
    queryKey: ['inventory', 'products', 'pos-catalog'],
    queryFn: async () => {
      try {
        const page = await getInventoryProducts({ pageSize: 100 });
        // POS-31: cache the sellable catalog (org-scoped) for offline selling.
        if (organizationId) void cacheSellableCatalog(organizationId, page);
        return page;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'NETWORK_ERROR' && organizationId) {
          const cached = await readCachedCatalog(organizationId);
          if (cached) return cached;
        }
        throw err;
      }
    },
    placeholderData: keepPreviousData,
  });
}

/** ISO currency reference data (`/v1/currencies`) for the money fields. */
export function useCurrencies() {
  return useQuery({ queryKey: ['fx', 'currencies'], queryFn: getCurrencies });
}

/**
 * The active organization (name, base currency, settings) — a single cached
 * query shared by every POS page (receipt headers, currency defaults).
 */
export function useActiveOrganization() {
  const { organizationId } = useSession();
  return useQuery({
    queryKey: ['organization', organizationId],
    queryFn: getActiveOrganization,
    enabled: organizationId !== null,
  });
}

/** Org base currency — the default for register float / cart currency. */
export function useOrgBaseCurrency(): string {
  const { data } = useActiveOrganization();
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
