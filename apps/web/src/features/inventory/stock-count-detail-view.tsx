'use client';

import { ArrowLeft, ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';
import { Can } from '@/lib/permissions';

import { inventoryErrorKey } from './errors';
import { useInventoryMutations, useInventoryStockCount, useInventoryWarehouses } from './hooks';
import { localizedLabel } from './labels';
import { compareQuantity } from './money';

function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

/**
 * Stock-count detail — the counted lines with expected/counted/variance, and
 * the apply action for drafts (INV-14). Applied counts are immutable and the
 * page degrades to read-only.
 */
export function StockCountDetailView({ id }: { id: string }) {
  const t = useTranslations('modules.inventory');
  const global = useTranslations();
  const locale = useLocale();
  const { data, isPending, isError } = useInventoryStockCount(id);
  const { data: warehouses } = useInventoryWarehouses();
  const { applyStockCount } = useInventoryMutations();

  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (isPending && !data)
    return <p className="py-10 text-center text-sm text-muted-foreground">{global('common.loading')}</p>;
  if (isError || !data) return <p className="py-10 text-center text-sm text-destructive">{t('errors.unknown')}</p>;

  const warehouseName = warehouses?.items.find((item) => item.id === data.warehouseId)?.name ?? data.warehouseName;
  const isDraft = data.status === 'draft';
  const variances = data.lines.filter((line) => compareQuantity(line.variance, '0') !== 0);

  const handleApply = async () => {
    setError(null);
    setSuccess(null);
    try {
      const result = await applyStockCount.mutateAsync(id);
      setSuccess(t('counts.appliedMessage', { count: String(result.correctionsApplied) }));
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <ModuleGate moduleKey="inventory">
      <div className="space-y-5 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${locale}/m/inventory/stock-counts`}>
                <ArrowLeft className="rtl:rotate-180" />
                {t('detail.back')}
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">{t('counts.detailTitle')}</h1>
            <Badge variant={isDraft ? 'default' : 'secondary'}>
              {isDraft ? t('counts.statusDraft') : t('counts.statusApplied')}
            </Badge>
          </div>
          {isDraft && (
            <Can permission="inventory:stock:count">
              <Button onClick={() => setConfirming(true)} loading={applyStockCount.isPending}>
                {t('counts.apply')}
              </Button>
            </Can>
          )}
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

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <ClipboardList className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">{t('counts.detailTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label={t('fields.warehouse')} value={warehouseName} />
              <DetailField label={t('counts.tableCreated')} value={formatDate(data.createdAt, locale)} />
              <DetailField label={t('counts.tableLines')} value={data.lines.length} />
              <DetailField label={t('counts.varianceCount')} value={variances.length} />
              <DetailField label={t('counts.countedAt')} value={formatDate(data.countedAt, locale)} />
              <DetailField label={t('fields.notes')} value={data.notes ?? '—'} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('counts.tableProduct')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('counts.tableExpected')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('counts.tableCounted')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('counts.tableVariance')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.lines.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                        {t('counts.empty')}
                      </td>
                    </tr>
                  ) : (
                    data.lines.map((line) => {
                      const variance = compareQuantity(line.variance, '0');
                      return (
                        <tr key={line.id} className="transition-colors hover:bg-accent/30">
                          <td className="px-4 py-3 font-medium" dir="auto">
                            {localizedLabel(line.nameI18n, locale, line.sku)}
                          </td>
                          <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">{line.expectedQuantity}</td>
                          <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">{line.countedQuantity}</td>
                          <td
                            className={`px-4 py-3 text-end font-mono text-xs tabular-nums ${
                              variance === 0
                                ? 'text-muted-foreground'
                                : variance > 0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-destructive'
                            }`}
                          >
                            {variance > 0 ? '+' : ''}
                            {line.variance}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <ConfirmDialog
          open={confirming}
          title={t('counts.applyConfirmTitle')}
          description={t('counts.applyConfirmBody', { name: warehouseName })}
          confirmLabel={t('counts.apply')}
          cancelLabel={global('common.cancel')}
          closeLabel={global('common.close')}
          loading={applyStockCount.isPending}
          onConfirm={() => void handleApply()}
          onCancel={() => setConfirming(false)}
        />
      </div>
    </ModuleGate>
  );
}
