'use client';

import { ArrowDownToLine, History, Lock, Repeat, Search, SlidersHorizontal, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { INVENTORY_PAGE_SIZE } from '@/lib/api/resources';
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

/**
 * The stock toolbar — search, warehouse filter, and the low-stock chip, all
 * URL-driven (kept separate so the view stays readable).
 */
function StockToolbar({
  searchInput,
  onSearchChange,
  warehouse,
  warehouseOptions,
  low,
  hasActiveFilters,
  onFilter,
  onReset,
}: {
  searchInput: string;
  onSearchChange: (value: string) => void;
  warehouse: string;
  warehouseOptions: Array<{ id: string; name: string }>;
  low: string;
  hasActiveFilters: boolean;
  onFilter: (patch: Record<string, string | undefined>) => void;
  onReset: () => void;
}) {
  const t = useTranslations('modules.inventory');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('stock.searchPlaceholder')}
          className="ps-9"
        />
      </div>
      <Select
        value={warehouse}
        onValueChange={(value) => onFilter({ warehouse: value })}
        aria-label={t('stock.filterWarehouse')}
        className="w-48"
      >
        <SelectItem value="">{t('stock.allWarehouses')}</SelectItem>
        {warehouseOptions.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.name}
          </SelectItem>
        ))}
      </Select>
      <Button
        variant={low === '1' ? 'secondary' : 'outline'}
        size="sm"
        aria-pressed={low === '1'}
        onClick={() => onFilter({ low: low === '1' ? '' : '1' })}
      >
        <TriangleAlert className="size-4" aria-hidden="true" />
        {t('stock.lowStockOnly')}
      </Button>
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <X />
          {t('list.resetFilters')}
        </Button>
      )}
    </div>
  );
}

export function StockView() {
  const t = useTranslations('modules.inventory');
  const global = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const basePath = `/${locale}/m/inventory/stock`;
  const { q, page, searchInput, setSearchInput, update } = useInventoryListUrlState({ basePath });
  const warehouse = searchParams.get('warehouse') ?? '';
  const low = searchParams.get('low') ?? '';
  const hasActiveFilters = Boolean(q || warehouse || low);
  const { data: variants } = useInventoryVariantOptions();
  const { data: warehouses } = useInventoryWarehouses();
  // ISO currency reference data (exponents) for the unit-cost/value columns.
  const { data: currencies, isPending: currenciesPending } = useCurrencies();
  const { data: stock, isPending } = useInventoryStock({
    page,
    pageSize: INVENTORY_PAGE_SIZE,
    ...(q ? { search: q } : {}),
    ...(warehouse ? { warehouseId: warehouse } : {}),
    ...(low === '1' ? { lowStock: true } : {}),
  });
  const { receiveStock, adjustStock } = useInventoryMutations();

  const [section, setSection] = useState<'receive' | 'adjust' | null>(null);
  // Row-action preselect: opening the form from a table row fixes the variant
  // (and its warehouse) so the user only fills quantity/cost/reason.
  const [preselect, setPreselect] = useState<{ variantId: string; warehouseId: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  /** Opens a stock form; with a row's variant/warehouse preselected when given. */
  const openForm = (next: 'receive' | 'adjust', row?: { variantId: string; warehouseId: string | null } | null) => {
    setPreselect(row?.variantId ? row : null);
    // Row actions always open (and retarget the open form); the header buttons
    // toggle like before.
    setSection(row?.variantId ? next : (current) => (current === next ? null : next));
    // The form sits above the table — bring it into view when triggered from
    // a row (the header buttons are already in view).
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  // Every sellable variant (not just the products-list display variant) so a
  // multi-variant product offers all of its SKUs in the receive/adjust pickers.
  const variantOptions = (variants?.items ?? []).map((variant) => ({
    variantId: variant.variantId,
    nameI18n: variant.nameI18n,
    sku: variant.sku,
  }));
  const warehouseOptions = (warehouses?.items ?? []).map((warehouse) => ({
    id: warehouse.id,
    name: warehouse.name,
  }));

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

  // Group the fetched rows by product so a multi-variant product reads as one
  // block — a group header row carries the name (with the page's distinct
  // variant count), and its variant rows nest below. Rows arrive sorted by
  // product name, so the shared helper turns each contiguous run into a group.
  const groups = groupStockRowsByProduct(stock?.items ?? []);

  return (
    <ModuleGate moduleKey="inventory">
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('stock.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('stock.subtitle')}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => openForm('receive')}>
              <ArrowDownToLine className="size-4" aria-hidden="true" />
              <span className="ms-1">{t('receive.title')}</span>
            </Button>
            <Button variant="outline" onClick={() => openForm('adjust')}>
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              <span className="ms-1">{t('adjust.title')}</span>
            </Button>
          </div>
        </div>

        <nav aria-label={t('stock.related')} className="flex flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${locale}/m/inventory/stock/movements`}>
              <History className="size-4" aria-hidden="true" />
              <span className="ms-1">{t('movements.title')}</span>
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${locale}/m/inventory/stock/transfers`}>
              <Repeat className="size-4" aria-hidden="true" />
              <span className="ms-1">{t('transfers.title')}</span>
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${locale}/m/inventory/stock/reservations`}>
              <Lock className="size-4" aria-hidden="true" />
              <span className="ms-1">{t('reservations.title')}</span>
            </Link>
          </Button>
        </nav>

        <StockToolbar
          searchInput={searchInput}
          onSearchChange={setSearchInput}
          warehouse={warehouse}
          warehouseOptions={warehouseOptions}
          low={low}
          hasActiveFilters={hasActiveFilters}
          onFilter={update}
          onReset={() => update({ q: '', warehouse: '', low: '' })}
        />

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
              // default variant/warehouse when another row is clicked.
              key={`receive-${preselect?.variantId ?? 'header'}`}
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
              key={`adjust-${preselect?.variantId ?? 'header'}`}
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
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    {/* No product column — rows are grouped under a product header row. */}
                    <th className="px-4 py-3 text-start font-medium">{t('stock.tableSku')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('stock.tableWarehouse')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('stock.tableOnHand')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('stock.tableReserved')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('stock.tableAvailable')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('stock.tableUnitCost')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('stock.tableValue')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('stock.tableReorder')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('stock.tableStatus')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('stock.tableActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {/* Currencies gate the render too so the monetary cells never
                      flash the fallback exponent (2) before the ISO data lands. */}
                  {(isPending && !stock) || (currenciesPending && !currencies) ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                        {global('common.loading')}
                      </td>
                    </tr>
                  ) : (stock?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                        {t('stock.empty')}
                      </td>
                    </tr>
                  ) : (
                    groups.map((group) => (
                      <Fragment key={group.productId}>
                        <tr className="bg-muted/40">
                          <td colSpan={10} className="px-4 py-2 text-sm font-semibold" dir="auto">
                            <Link
                              href={`/${locale}/m/inventory/products/${group.productId}`}
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              {localizedLabel(group.nameI18n, locale, '—')}
                            </Link>
                            {/* Distinct variant count in this group on this page
                                (rows can repeat per warehouse — the badge counts
                                SKUs, mirroring the products list). */}
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
                              <td className="px-4 py-3">
                                {/* A never-received variant with no warehouse yet
                                targets the org's default warehouse. */}
                                {row.warehouseName ?? t('receive.defaultWarehouse')}
                              </td>
                              <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                                {row.quantityOnHand}
                              </td>
                              <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                                {row.quantityReserved}
                              </td>
                              <td className="px-4 py-3 text-end font-mono text-xs font-semibold tabular-nums">
                                {row.quantityAvailable}
                              </td>
                              {/* Valuation cells — exact integer math (hard rule #3). */}
                              <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">{valuation.cost}</td>
                              <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">{valuation.value}</td>
                              <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">{row.reorderPoint}</td>
                              <td className="px-4 py-3">
                                {low ? (
                                  <Badge variant="destructive">{t('stock.lowStock')}</Badge>
                                ) : (
                                  <Badge variant="secondary">{t('stock.inStock')}</Badge>
                                )}
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

        <InventoryPagination
          page={page}
          pageSize={stock?.pageSize ?? INVENTORY_PAGE_SIZE}
          total={stock?.total ?? 0}
          loading={isPending}
          onChange={(nextPage) => update({ page: String(nextPage) })}
        />
      </div>
    </ModuleGate>
  );
}
