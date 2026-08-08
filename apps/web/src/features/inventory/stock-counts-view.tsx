'use client';

import { ClipboardList, X } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select, SelectItem } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { INVENTORY_PAGE_SIZE } from '@/lib/api/resources';
import { ModuleGate } from '@/lib/entitlements';

import { inventoryErrorKey } from './errors';
import { StockCountForm } from './forms';
import {
  useInventoryMutations,
  useInventoryStockCounts,
  useInventoryVariantOptions,
  useInventoryWarehouses,
} from './hooks';
import { InventoryPagination, useInventoryListUrlState } from './table-shared';
import type { StockCountFormValues, StockCountLineValues } from './schemas';

export function StockCountsView() {
  const t = useTranslations('modules.inventory');
  const global = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const basePath = `/${locale}/m/inventory/stock-counts`;
  const { page, update } = useInventoryListUrlState({ basePath });
  const status = searchParams.get('status') ?? '';
  const hasActiveFilters = Boolean(status);
  // The count form's variant picker needs EVERY sellable variant — the
  // variants list returns one row per variant (largest page the API allows).
  const { data: variants } = useInventoryVariantOptions();
  const { data: warehouses } = useInventoryWarehouses();
  const { data: counts, isPending } = useInventoryStockCounts({
    page,
    pageSize: INVENTORY_PAGE_SIZE,
    ...(status === 'draft' || status === 'applied' ? { status } : {}),
  });
  const { createStockCount, applyStockCount } = useInventoryMutations();

  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [applyTarget, setApplyTarget] = useState<{ id: string; name: string } | null>(null);

  const variantOptions = (variants?.items ?? []).map((variant) => ({
    variantId: variant.variantId,
    nameI18n: variant.nameI18n,
    sku: variant.sku,
  }));
  const warehouseOptions = (warehouses?.items ?? []).map((warehouse) => ({
    id: warehouse.id,
    name: warehouse.name,
  }));

  const warehouseName = (id: string): string => warehouseOptions.find((warehouse) => warehouse.id === id)?.name ?? '—';

  const handleCreate = async (values: StockCountFormValues & { lines: StockCountLineValues[] }) => {
    setError(null);
    setSuccess(null);
    try {
      await createStockCount.mutateAsync({
        warehouseId: values.warehouseId,
        ...(values.notes ? { notes: values.notes } : {}),
        lines: values.lines,
      });
      setSuccess(t('counts.createdMessage'));
      setShowForm(false);
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    }
  };

  const handleApply = async () => {
    if (!applyTarget) return;
    setError(null);
    setSuccess(null);
    try {
      const result = await applyStockCount.mutateAsync(applyTarget.id);
      setSuccess(t('counts.appliedMessage', { count: String(result.correctionsApplied) }));
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    } finally {
      setApplyTarget(null);
    }
  };

  return (
    <ModuleGate moduleKey="inventory">
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('counts.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('counts.subtitle')}</p>
          </div>
          <Button onClick={() => setShowForm((current) => !current)}>
            <ClipboardList className="size-4" aria-hidden="true" />
            <span className="ms-1">{t('counts.create')}</span>
          </Button>
        </div>

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

        {showForm && (
          <StockCountForm
            variants={variantOptions}
            warehouses={warehouseOptions}
            onSubmit={handleCreate}
            pending={createStockCount.isPending}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={status}
            onValueChange={(value) => update({ status: value })}
            aria-label={t('counts.filterStatus')}
            className="w-44"
          >
            <SelectItem value="">{t('counts.allStatuses')}</SelectItem>
            <SelectItem value="draft">{t('counts.statusDraft')}</SelectItem>
            <SelectItem value="applied">{t('counts.statusApplied')}</SelectItem>
          </Select>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={() => update({ status: '' })}>
              <X />
              {t('list.resetFilters')}
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('counts.tableCreated')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('counts.tableWarehouse')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('counts.tableLines')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('counts.tableStatus')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('counts.tableActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isPending && !counts ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        {global('common.loading')}
                      </td>
                    </tr>
                  ) : (counts?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        {t('counts.empty')}
                      </td>
                    </tr>
                  ) : (
                    counts?.items.map((count) => (
                      <tr key={count.id} className="transition-colors hover:bg-accent/30">
                        <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-muted-foreground">
                          <Link
                            href={`/${locale}/m/inventory/stock-counts/${count.id}`}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {new Date(count.createdAt).toLocaleString(locale, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{warehouseName(count.warehouseId)}</td>
                        <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">{count.lines.length}</td>
                        <td className="px-4 py-3">
                          <Badge variant={count.status === 'applied' ? 'secondary' : 'default'}>
                            {count.status === 'applied' ? t('counts.statusApplied') : t('counts.statusDraft')}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-end">
                          {count.status === 'draft' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setApplyTarget({ id: count.id, name: warehouseName(count.warehouseId) })}
                            >
                              {t('counts.apply')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <InventoryPagination
          page={page}
          pageSize={counts?.pageSize ?? INVENTORY_PAGE_SIZE}
          total={counts?.total ?? 0}
          loading={isPending}
          onChange={(nextPage) => update({ page: String(nextPage) })}
        />

        <ConfirmDialog
          open={applyTarget !== null}
          title={t('counts.applyConfirmTitle')}
          description={applyTarget ? t('counts.applyConfirmBody', { name: applyTarget.name }) : undefined}
          confirmLabel={t('counts.apply')}
          cancelLabel={global('common.cancel')}
          closeLabel={global('common.close')}
          loading={applyStockCount.isPending}
          onConfirm={() => void handleApply()}
          onCancel={() => setApplyTarget(null)}
        />
      </div>
    </ModuleGate>
  );
}
