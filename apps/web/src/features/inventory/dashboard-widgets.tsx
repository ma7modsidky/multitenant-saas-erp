'use client';

// Inventory dashboard widgets — content bodies rendered inside the platform
// dashboard cards registered by inventory.descriptor.ts (PLAN §3.3). The
// dashboard page keys widget ids to these components; the data comes from the
// module's existing read endpoints via the shared inventory hooks, so the
// cards share cache and invalidation with the module pages.

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { useCurrencies, useInventoryStock } from './hooks';
import { localizedLabel } from './labels';
import { formatMinorAmount, sumValuationByCurrency } from './money';

/** Skeleton rows shown while the widget's first query is loading. */
function WidgetSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-5 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

/**
 * Low stock (INV-13) — variants whose AVAILABLE stock has crossed below the
 * reorder point, same semantics as the backend job (`available < reorder`).
 *
 * The backend `lowStock` filter applies that exact strict comparison (and
 * treats never-received variants with a positive reorder point as low, like
 * their stock-page badge), so the widget fetches the complete org-wide low
 * set in one request instead of client-filtering the default 12-row page.
 * Up to 100 low rows come back (the backend clamp); the widget renders the
 * first five.
 */
export function InventoryLowStockWidget() {
  const t = useTranslations();
  const locale = useLocale();
  const { data, isPending } = useInventoryStock({ lowStock: true, pageSize: 100 });

  const lowStock = data?.items ?? [];

  return (
    <div className="space-y-1">
      {isPending && !data ? (
        <WidgetSkeleton rows={4} />
      ) : lowStock.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">{t('dashboard.widgets.lowStockEmpty')}</p>
      ) : (
        <ul className="space-y-0.5">
          {lowStock.slice(0, 5).map((row) => (
            <li key={`${row.variantId}-${row.warehouseId}`}>
              <Link
                href={`/${locale}/m/inventory/stock`}
                className="group flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50"
              >
                <span className="min-w-0 flex-1">
                  {/* Product name on its own line; the SKU below is the row's
                      variant identifier (same as the stock page), so a product
                      with several low-stock variants reads as distinct rows
                      instead of repeated names. */}
                  <span className="block truncate text-sm font-medium group-hover:text-primary" dir="auto">
                    {localizedLabel(row.nameI18n, locale)}
                  </span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {row.sku}
                    {row.warehouseName ? ` · ${row.warehouseName}` : ''}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-destructive">
                  {row.quantityAvailable} / {row.reorderPoint}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="pt-2">
        <Link href={`/${locale}/m/inventory/stock`} className="text-xs font-medium text-primary hover:underline">
          {t('dashboard.widgets.viewAll')}
        </Link>
      </div>
    </div>
  );
}

/**
 * Stock valuation — on-hand × unit cost per variant, grouped by currency.
 * Exact BigInt math (hard rule #3); per-currency totals avoid inventing an FX
 * conversion in a widget (the org can convert in reports later).
 *
 * Fetches the FULL catalog (pageSize 100, the backend's max clamp) rather than
 * the default 12-row page so the org-wide total isn't silently truncated to
 * the first page. For orgs with >100 variant×warehouse rows the widget is
 * capped at the first 100 — pagewise accumulation would be needed for a truly
 * unbounded total (same ceiling as the variant pickers).
 */
export function InventoryStockValuationWidget() {
  const t = useTranslations();
  const locale = useLocale();
  const { data: currencies } = useCurrencies();
  const { data, isPending } = useInventoryStock({ pageSize: 100 });

  const totals = sumValuationByCurrency(data?.items ?? []);

  return (
    <div className="space-y-1">
      {isPending && !data ? (
        <WidgetSkeleton rows={2} />
      ) : totals.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">{t('dashboard.widgets.stockValuationEmpty')}</p>
      ) : (
        <ul className="space-y-0.5">
          {totals.map(([currency, amount]) => (
            <li key={currency} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm">
              <span className="text-muted-foreground">{currency}</span>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {formatMinorAmount(amount, currency, {
                  locale,
                  exponent: currencies?.find((c) => c.code === currency)?.exponent ?? 2,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="pt-2">
        <Link href={`/${locale}/m/inventory/stock`} className="text-xs font-medium text-primary hover:underline">
          {t('dashboard.widgets.viewAll')}
        </Link>
      </div>
    </div>
  );
}
