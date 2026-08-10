'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adjustInventoryStock,
  applyInventoryStockCount,
  archiveInventoryProduct,
  archiveInventoryVariant,
  createInventoryProduct,
  createInventoryStockCount,
  createInventoryVariant,
  createInventoryWarehouse,
  getActiveOrganization,
  getCurrencies,
  getInventoryMovements,
  getInventoryProduct,
  getInventoryProducts,
  getInventoryReservations,
  getInventoryStock,
  getInventoryStockCount,
  getInventoryStockCounts,
  getInventoryVariants,
  getInventoryWarehouses,
  receiveInventoryStock,
  transferInventoryStock,
  unarchiveInventoryProduct,
  unarchiveInventoryVariant,
  updateInventoryProduct,
  updateInventoryVariant,
  type InventoryMovementParams,
  type InventoryProductParams,
  type InventoryReservationParams,
  type InventoryStockCountParams,
  type InventoryStockParams,
  type InventoryVariantParams,
} from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';

/** Stable query-key namespace for the inventory module (invalidation scope). */
const inventoryKey = (parts: string[]): string[] => ['inventory', ...parts];

/** Stable key for a filtered stock-levels list (cache + invalidation). */
function stockKey(filters: InventoryStockParams = {}): string[] {
  return [
    'inventory',
    'stock',
    filters.search ?? '',
    filters.warehouseId ?? '',
    filters.lowStock ? 'low' : 'all',
    String(filters.page ?? 1),
    String(filters.pageSize ?? 12),
  ];
}

/** Stable key for a filtered movements ledger (cache + invalidation). */
function movementsKey(filters: InventoryMovementParams = {}): string[] {
  return [
    'inventory',
    'movements',
    filters.search ?? '',
    filters.type ?? '',
    filters.fromDate ?? '',
    filters.toDate ?? '',
    String(filters.page ?? 1),
    String(filters.pageSize ?? 12),
  ];
}

/** Stable key for a filtered reservations list (cache + invalidation). */
function reservationsKey(filters: InventoryReservationParams = {}): string[] {
  return ['inventory', 'reservations', filters.status ?? '', String(filters.page ?? 1), String(filters.pageSize ?? 12)];
}

/** Stable key for a filtered products list (cache + invalidation). */
function productsKey(filters: InventoryProductParams = {}): string[] {
  return [
    'inventory',
    'products',
    filters.search ?? '',
    filters.status ?? '',
    String(filters.page ?? 1),
    String(filters.pageSize ?? 12),
  ];
}

/** Stable key for a filtered stock-counts list (cache + invalidation). */
function stockCountsKey(filters: InventoryStockCountParams = {}): string[] {
  return ['inventory', 'stock-counts', filters.status ?? '', String(filters.page ?? 1), String(filters.pageSize ?? 12)];
}

export function useInventoryProducts(filters: InventoryProductParams = {}, enabled = true) {
  return useQuery({
    queryKey: productsKey(filters),
    queryFn: () => getInventoryProducts(filters),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useInventoryWarehouses() {
  return useQuery({ queryKey: inventoryKey(['warehouses']), queryFn: getInventoryWarehouses });
}

/** Stable key for a filtered variants picker list (cache + invalidation). */
function variantsKey(filters: InventoryVariantParams = {}): string[] {
  return ['inventory', 'variants', filters.search ?? '', String(filters.page ?? 1), String(filters.pageSize ?? 100)];
}

/**
 * Every sellable variant org-wide — the receive/adjust/transfer/count pickers.
 * Unlike the products list (one display variant per product), this has a row
 * for EACH variant, so a multi-variant product shows all of its SKUs.
 */
export function useInventoryVariantOptions(filters: InventoryVariantParams = { pageSize: 100 }) {
  return useQuery({
    queryKey: variantsKey(filters),
    queryFn: () => getInventoryVariants(filters),
    placeholderData: keepPreviousData,
  });
}

export function useInventoryStock(filters: InventoryStockParams = {}) {
  return useQuery({
    queryKey: stockKey(filters),
    queryFn: () => getInventoryStock(filters),
    placeholderData: keepPreviousData,
  });
}

export function useInventoryMovements(filters: InventoryMovementParams = {}) {
  return useQuery({
    queryKey: movementsKey(filters),
    queryFn: () => getInventoryMovements(filters),
    placeholderData: keepPreviousData,
  });
}

export function useInventoryStockCounts(filters: InventoryStockCountParams = {}) {
  return useQuery({
    queryKey: stockCountsKey(filters),
    queryFn: () => getInventoryStockCounts(filters),
    placeholderData: keepPreviousData,
  });
}

export function useInventoryProduct(id: string, enabled = true) {
  return useQuery({
    queryKey: inventoryKey(['products', id]),
    queryFn: () => getInventoryProduct(id),
    enabled,
  });
}

export function useInventoryReservations(filters: InventoryReservationParams = {}) {
  return useQuery({
    queryKey: reservationsKey(filters),
    queryFn: () => getInventoryReservations(filters),
    placeholderData: keepPreviousData,
  });
}

export function useInventoryStockCount(id: string) {
  return useQuery({
    queryKey: inventoryKey(['stock-counts', id]),
    queryFn: () => getInventoryStockCount(id),
  });
}

/** ISO currency reference data (`/v1/currencies`) for the money fields. */
export function useCurrencies() {
  return useQuery({ queryKey: ['fx', 'currencies'], queryFn: getCurrencies });
}

/** Org base currency — the default for price/cost/unit-cost fields. */
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
 * Inventory mutations. Every mutation invalidates the `['inventory']` scope;
 * product-scoped ones (variant add/archive) also invalidate the product detail
 * so the detail page refetches in place.
 */
export function useInventoryMutations() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ['inventory'] });
  const invalidateProduct = (id: string) =>
    Promise.all([invalidate(), client.invalidateQueries({ queryKey: inventoryKey(['products', id]) })]);
  return {
    createProduct: useMutation({ mutationFn: createInventoryProduct, onSuccess: invalidate }),
    updateProduct: useMutation({
      mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof updateInventoryProduct>[1]) =>
        updateInventoryProduct(id, input),
      onSuccess: invalidate,
    }),
    archiveProduct: useMutation({ mutationFn: archiveInventoryProduct, onSuccess: invalidate }),
    unarchiveProduct: useMutation({ mutationFn: unarchiveInventoryProduct, onSuccess: invalidate }),
    updateVariant: useMutation({
      mutationFn: ({
        productId,
        variantId,
        ...input
      }: { productId: string; variantId: string } & Parameters<typeof updateInventoryVariant>[1]) =>
        updateInventoryVariant(variantId, input).then(() => ({ productId, variantId })),
      onSuccess: (_result, variables) => void invalidateProduct(variables.productId),
    }),
    createVariant: useMutation({
      mutationFn: ({ productId, ...input }: { productId: string } & Parameters<typeof createInventoryVariant>[1]) =>
        createInventoryVariant(productId, input),
      onSuccess: (_result, variables) => void invalidateProduct(variables.productId),
    }),
    archiveVariant: useMutation({
      mutationFn: ({ variantId, productId }: { variantId: string; productId: string }) =>
        archiveInventoryVariant(variantId).then(() => ({ variantId, productId })),
      onSuccess: (_result, variables) => void invalidateProduct(variables.productId),
    }),
    unarchiveVariant: useMutation({
      mutationFn: ({ variantId, productId }: { variantId: string; productId: string }) =>
        unarchiveInventoryVariant(variantId).then(() => ({ variantId, productId })),
      onSuccess: (_result, variables) => void invalidateProduct(variables.productId),
    }),
    createWarehouse: useMutation({ mutationFn: createInventoryWarehouse, onSuccess: invalidate }),
    receiveStock: useMutation({ mutationFn: receiveInventoryStock, onSuccess: invalidate }),
    adjustStock: useMutation({ mutationFn: adjustInventoryStock, onSuccess: invalidate }),
    transferStock: useMutation({ mutationFn: transferInventoryStock, onSuccess: invalidate }),
    createStockCount: useMutation({ mutationFn: createInventoryStockCount, onSuccess: invalidate }),
    applyStockCount: useMutation({ mutationFn: applyInventoryStockCount, onSuccess: invalidate }),
  };
}
