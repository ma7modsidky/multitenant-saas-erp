'use client';

// Shared building blocks for the inventory list views (stock, movements,
// reservations) — the same URL-state + pagination pattern the CRM tables use:
// every filter lives in the URL (`q`, `page`, plus view-specific params the
// caller reads/writes through `update`), so views are shareable, the back
// button behaves, and the page number resets whenever a filter changes.

import { ArrowDownToLine, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import type { InventoryStockLevel } from '@/lib/api/resources';

import { formatMinorAmount, valueAtCost } from './money';

/**
 * URL-driven list state for an inventory list view: debounced search `q`,
 * `page`, and a generic `update` for view-specific filter params (warehouse,
 * type, status, dates, …). Filter changes reset to page 1.
 *
 * @param basePath e.g. `/${locale}/m/inventory/stock`
 */
export function useInventoryListUrlState({ basePath }: { basePath: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const q = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  // Local input debounced into the `q` param — no refetch per keystroke.
  const [searchInput, setSearchInput] = useState(q);
  useEffect(() => setSearchInput(q), [q]);
  useEffect(() => {
    if (searchInput === q) return;
    const id = setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());
      if (searchInput) next.set('q', searchInput);
      else next.delete('q');
      next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput, q, basePath, router, searchParams]);

  /**
   * Merge a patch into the URL; empty/undefined values remove the param, and
   * any non-`page` change resets to page 1.
   */
  const update = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
    },
    [basePath, router, searchParams],
  );

  return { q, page, searchInput, setSearchInput, update };
}

/**
 * Previous/next pagination footer using the inventory `list.*` i18n keys.
 * Renders nothing meaningful when there is a single page — the total is still
 * shown so the count stays visible.
 */
export function InventoryPagination({
  page,
  pageSize,
  total,
  loading,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onChange: (page: number) => void;
}) {
  const t = useTranslations('modules.inventory');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{t('list.total', { count: total })}</p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="rtl:rotate-180" />
          {t('list.previous')}
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground">{t('list.pageOf', { page, pages })}</span>
        <Button variant="outline" size="sm" disabled={page >= pages || loading} onClick={() => onChange(page + 1)}>
          {t('list.next')}
          <ChevronRight className="rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}

/** A contiguous product run within a fetched page of stock rows. */
export interface ProductGroup {
  productId: string;
  nameI18n: Record<string, string>;
  rows: InventoryStockLevel[];
}

/**
 * Group a page of stock rows into contiguous product runs. The backend returns
 * rows sorted by product name, so each run on the page is one product; a page
 * boundary can split a product across pages, in which case each page groups
 * independently. Rows repeat per warehouse, so callers count distinct
 * variantIds for badge semantics.
 */
export function groupStockRowsByProduct(rows: InventoryStockLevel[]): ProductGroup[] {
  const groups: ProductGroup[] = [];
  for (const row of rows) {
    const current = groups[groups.length - 1];
    if (current && current.productId === row.productId) current.rows.push(row);
    else groups.push({ productId: row.productId, nameI18n: row.nameI18n, rows: [row] });
  }
  return groups;
}

/**
 * The per-row receive/adjust actions (kept small so the row callback stays
 * readable and under the lint line budget). The cell wrapper (`<td>`) belongs
 * to the caller — this renders the button cluster only.
 */
export function StockRowActions({
  sku,
  onReceive,
  onAdjust,
}: {
  sku: string;
  onReceive: () => void;
  onAdjust: () => void;
}) {
  const t = useTranslations('modules.inventory');
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" aria-label={`${t('receive.title')}: ${sku}`} onClick={onReceive}>
        <ArrowDownToLine className="size-4" aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="sm" aria-label={`${t('adjust.title')}: ${sku}`} onClick={onAdjust}>
        <SlidersHorizontal className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * Formats a stock row's unit cost + on-hand value (exact integer math, hard
 * rule #3) for the cost/value cells. Rows without a unit cost render an
 * em-dash. The ISO currency reference data (`useCurrencies`) supplies the
 * per-currency exponent (fallback 2 for unknown currencies).
 */
export function formatStockRowValuation(
  row: { quantityOnHand: string; unitCost: { amountMinor: string; currency: string } | null },
  locale: string,
  currencies: Array<{ code: string; exponent: number }> | undefined,
): { cost: string; value: string } {
  if (row.unitCost === null) return { cost: '—', value: '—' };
  const { amountMinor, currency } = row.unitCost;
  const options = { locale, exponent: currencies?.find((c) => c.code === currency)?.exponent ?? 2 };
  return {
    cost: formatMinorAmount(amountMinor, currency, options),
    value: formatMinorAmount(valueAtCost(row.quantityOnHand, amountMinor), currency, options),
  };
}
