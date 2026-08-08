'use client';

import { ArrowLeft, MapPin, Warehouse } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';

import { inventoryErrorKey } from './errors';
import { AdjustStockForm, ReceiveStockForm } from './forms';
import {
  useCurrencies,
  useInventoryMutations,
  useInventoryStock,
  useInventoryVariantOptions,
  useInventoryWarehouses,
} from './hooks';
import { localizedLabel } from './labels';
import { compareQuantity } from './money';
import type { AdjustStockFormValues, ReceiveStockFormValues } from './schemas';
import {
  formatStockRowValuation,
  groupStockRowsByProduct,
  InventoryPagination,
  StockRowActions,
  useInventoryListUrlState,
} from './table-shared';

/** Rows per page on the detail table (backend clamps pageSize to 1–100). */
const WAREHOUSE_PAGE_SIZE = 100;

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

/**
 * Warehouse detail — record + the stock held at this location. Composed from
 * the warehouses list and the stock projection (both tenant-scoped reads), so
 * no extra backend endpoint is needed.
 */
export function WarehouseDetailView({ id }: { id: string }) {
  const t = useTranslations('modules.inventory');
  const global = useTranslations();
  const locale = useLocale();
  const basePath = `/${locale}/m/inventory/warehouses/${id}`;
  // URL-driven page state (the stock-list pattern) — the back button and
  // shared links keep their page, and a fresh warehouse URL starts at page 1.
  const { page, update } = useInventoryListUrlState({ basePath });
  const { data: warehouses, isPending: warehousesPending } = useInventoryWarehouses();
  // Fetch this warehouse's matrix one page at a time (one row per sellable
  // variant) — the 12-row default would silently truncate the grouped view,
  // and filtering server-side avoids other warehouses' rows consuming the
  // page budget.
  const { data: stock, isPending: stockPending } = useInventoryStock({
    warehouseId: id,
    page,
    pageSize: WAREHOUSE_PAGE_SIZE,
  });
  // Accurate low-stock count across all pages — the header badge reads the
  // envelope's total (one item is enough to carry it), not the current page's
  // rows.
  const { data: lowStockData } = useInventoryStock({ warehouseId: id, lowStock: true, pageSize: 1 });
  // Every sellable variant org-wide for the receive/adjust pickers (same as
  // the stock page).
  const { data: variants } = useInventoryVariantOptions();
  // ISO currency reference data (exponents) for the unit-cost/value formatting.
  const { data: currencies, isPending: currenciesPending } = useCurrencies();
  const { receiveStock, adjustStock } = useInventoryMutations();

  const [section, setSection] = useState<'receive' | 'adjust' | null>(null);
  // Row-action preselect: opening the form from a table row fixes the variant
  // (the page's warehouse is already the form's context) so the user only
  // fills quantity/cost/reason.
  const [preselect, setPreselect] = useState<{ variantId: string; warehouseId: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  /** Opens a stock form with the row's variant preselected. */
  const openForm = (next: 'receive' | 'adjust', row: { variantId: string; warehouseId: string | null }) => {
    setPreselect(row);
    setSection(next);
    // The form sits above the table — bring it into view when triggered from
    // a row.
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const closeForm = () => {
    setSection(null);
    setPreselect(null);
  };

  const handleReceive = async (values: ReceiveStockFormValues) => {
    setError(null);
    setSuccess(null);
    try {
      await receiveStock.mutateAsync({
        variantId: values.variantId,
        ...(values.warehouseId ? { warehouseId: values.warehouseId } : {}),
        quantity: values.quantity,
        unitCost: { amountMinor: values.unitCostAmountMinor, currency: values.unitCostCurrency },
        referenceType: 'manual',
        referenceId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      });
      setSuccess(t('receive.success'));
      closeForm();
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    }
  };

  const handleAdjust = async (values: AdjustStockFormValues) => {
    setError(null);
    setSuccess(null);
    try {
      await adjustStock.mutateAsync({
        variantId: values.variantId,
        ...(values.warehouseId ? { warehouseId: values.warehouseId } : {}),
        quantity: values.quantity,
        reasonCode: values.reasonCode,
        referenceType: 'manual',
        referenceId: crypto.randomUUID(),
      });
      setSuccess(t('adjust.success'));
      closeForm();
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    }
  };

  // Currencies gate the render too so monetary cells never flash the fallback
  // exponent (2) before the ISO reference data arrives.
  if ((warehousesPending && !warehouses) || (stockPending && !stock) || (currenciesPending && !currencies))
    return <p className="py-10 text-center text-sm text-muted-foreground">{global('common.loading')}</p>;

  const warehouse = warehouses?.items.find((item) => item.id === id);
  if (!warehouse) return <p className="py-10 text-center text-sm text-destructive">{t('errors.unknown')}</p>;

  const rows = stock?.items ?? [];

  const variantOptions = (variants?.items ?? []).map((variant) => ({
    variantId: variant.variantId,
    nameI18n: variant.nameI18n,
    sku: variant.sku,
  }));
  const warehouseOptions = (warehouses?.items ?? []).map((warehouse) => ({
    id: warehouse.id,
    name: warehouse.name,
  }));

  // Same product grouping as the stock page — rows arrive sorted by product
  // name, so the shared helper turns each contiguous run into a group.
  const groups = groupStockRowsByProduct(rows);

  return (
    <ModuleGate moduleKey="inventory">
      <div className="space-y-5 animate-fade-in">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${locale}/m/inventory/warehouses`}>
              <ArrowLeft className="rtl:rotate-180" />
              {t('detail.back')}
            </Link>
          </Button>
          <h1 className="text-xl font-semibold" dir="auto">
            {warehouse.name}
          </h1>
          {warehouse.isDefault && <Badge variant="secondary">{t('warehouses.default')}</Badge>}
          <Badge variant={warehouse.isActive ? 'default' : 'secondary'}>
            {warehouse.isActive ? t('warehouses.active') : t('warehouses.inactive')}
          </Badge>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <Warehouse className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">{t('detail.warehouseDetails')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label={t('fields.code')} value={<span className="font-mono">{warehouse.code}</span>} />
              <DetailField
                label={t('warehouses.tableDefault')}
                value={warehouse.isDefault ? <Badge variant="secondary">{t('warehouses.default')}</Badge> : '—'}
              />
              <DetailField label={t('detail.stockRows')} value={stock?.total ?? 0} />
              <DetailField label={t('detail.lowStockItems')} value={lowStockData ? lowStockData.total : '—'} />
            </dl>
          </CardContent>
        </Card>

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t(error)}
          </p>
        )}
        {success && (
          <p
            role="status"
            className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
          >
            {success}
          </p>
        )}

        <div ref={formRef}>
          {section === 'receive' && (
            <ReceiveStockForm
              // Remount per preselect so react-hook-form picks up the new
              // default variant when another row is clicked.
              key={`receive-${preselect?.variantId}-${preselect?.warehouseId ?? 'detail'}`}
              variants={variantOptions}
              warehouses={warehouseOptions}
              {...(preselect
                ? { initialValues: { variantId: preselect.variantId, warehouseId: preselect.warehouseId ?? '' } }
                : {})}
              onSubmit={handleReceive}
              pending={receiveStock.isPending}
            />
          )}
          {section === 'adjust' && (
            <AdjustStockForm
              key={`adjust-${preselect?.variantId}-${preselect?.warehouseId ?? 'detail'}`}
              variants={variantOptions}
              warehouses={warehouseOptions}
              {...(preselect
                ? { initialValues: { variantId: preselect.variantId, warehouseId: preselect.warehouseId ?? '' } }
                : {})}
              onSubmit={handleAdjust}
              pending={adjustStock.isPending}
            />
          )}
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <MapPin className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">{t('detail.stockAtWarehouse')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    {/* No product column — rows are grouped under a product header row. */}
                    <th className="px-4 py-3 text-start font-medium">{t('stock.tableSku')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('stock.tableOnHand')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('stock.tableReserved')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('stock.tableAvailable')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('stock.tableUnitCost')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('stock.tableValue')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('stock.tableStatus')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('stock.tableActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                        {t('stock.empty')}
                      </td>
                    </tr>
                  ) : (
                    groups.map((group) => (
                      <Fragment key={group.productId}>
                        <tr className="bg-muted/40">
                          <td colSpan={8} className="px-4 py-2 text-sm font-semibold" dir="auto">
                            <Link
                              href={`/${locale}/m/inventory/products/${group.productId}`}
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              {localizedLabel(group.nameI18n, locale, '—')}
                            </Link>
                            {/* Distinct variant count at this warehouse (one row
                                per variant here, mirroring the stock page). */}
                            <Badge variant="outline" className="ms-2 tabular-nums">
                              {new Set(group.rows.map((row) => row.variantId)).size}
                            </Badge>
                          </td>
                        </tr>
                        {group.rows.map((row) => {
                          const low = compareQuantity(row.quantityAvailable, row.reorderPoint) < 0;
                          const actions = { variantId: row.variantId, warehouseId: row.warehouseId };
                          const valuation = formatStockRowValuation(row, locale, currencies);
                          return (
                            <tr
                              key={`${row.variantId}-${row.warehouseId ?? 'default'}`}
                              className="transition-colors hover:bg-accent/30"
                            >
                              <td className="px-4 py-3 font-mono text-xs">{row.sku}</td>
                              <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                                {row.quantityOnHand}
                              </td>
                              <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                                {row.quantityReserved}
                              </td>
                              <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                                {row.quantityAvailable}
                              </td>
                              {/* Valuation cells — exact integer math (hard rule #3). */}
                              <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">{valuation.cost}</td>
                              <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">{valuation.value}</td>
                              <td className="px-4 py-3">
                                <Badge variant={low ? 'destructive' : 'default'}>
                                  {low ? t('stock.lowStock') : t('stock.inStock')}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-end">
                                <StockRowActions
                                  sku={row.sku}
                                  onReceive={() => openForm('receive', actions)}
                                  onAdjust={() => openForm('adjust', actions)}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Paginated stock table — page boundaries split a product's header
            across pages (same tradeoff as the stock page). */}
        <InventoryPagination
          page={page}
          pageSize={WAREHOUSE_PAGE_SIZE}
          total={stock?.total ?? 0}
          loading={stockPending}
          onChange={(nextPage) => update({ page: String(nextPage) })}
        />
      </div>
    </ModuleGate>
  );
}
