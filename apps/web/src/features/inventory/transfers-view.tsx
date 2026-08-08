'use client';

import { Repeat } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';

import { inventoryErrorKey } from './errors';
import { TransferForm } from './forms';
import {
  useInventoryMutations,
  useInventoryMovements,
  useInventoryVariantOptions,
  useInventoryWarehouses,
} from './hooks';
import { localizedLabel } from './labels';
import type { TransferStockFormValues } from './schemas';

export function TransfersView() {
  const t = useTranslations('modules.inventory');
  const locale = useLocale();
  const { data: variants } = useInventoryVariantOptions();
  const { data: warehouses } = useInventoryWarehouses();
  // The transfer history pairs movements by referenceId — pull a full catalog
  // page so older transfers aren't silently missing their Repeat row.
  const { data: movements } = useInventoryMovements({ pageSize: 100 });
  const { transferStock } = useInventoryMutations();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Every sellable variant (not just the products-list display variant) so a
  // multi-variant product offers all of its SKUs in the transfer picker.
  const variantOptions = (variants?.items ?? []).map((variant) => ({
    variantId: variant.variantId,
    nameI18n: variant.nameI18n,
    sku: variant.sku,
  }));
  const warehouseOptions = (warehouses?.items ?? []).map((warehouse) => ({
    id: warehouse.id,
    name: warehouse.name,
    code: warehouse.code,
  }));

  // INV-9 transfers write two ledger rows (transfer_out + transfer_in) sharing
  // one referenceId — pair them so each transfer shows as a single from → to row.
  interface TransferPair {
    /** First-seen movement id — stable React key for the pair. */
    id: string;
    variantId: string;
    occurredAt: string;
    nameI18n: Record<string, string>;
    sku: string;
    quantity: string;
    fromWarehouseId: string | null;
    toWarehouseId: string | null;
  }
  const transferPairs = new Map<string, TransferPair>();
  for (const movement of movements?.items ?? []) {
    if (movement.type !== 'transfer_out' && movement.type !== 'transfer_in') continue;
    const existing = transferPairs.get(movement.referenceId);
    const pair: TransferPair = existing ?? {
      id: movement.id,
      variantId: movement.variantId,
      occurredAt: movement.occurredAt,
      nameI18n: movement.nameI18n,
      sku: movement.sku,
      quantity: movement.quantity,
      fromWarehouseId: null,
      toWarehouseId: null,
    };
    if (movement.type === 'transfer_out') pair.fromWarehouseId = movement.warehouseId;
    else pair.toWarehouseId = movement.warehouseId;
    pair.occurredAt = movement.occurredAt;
    transferPairs.set(movement.referenceId, pair);
  }
  const transfers = [...transferPairs.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  // Row-action preselect: "repeat transfer" fills the form with the past
  // transfer's variant and from/to warehouses so only the quantity is needed.
  const [preselect, setPreselect] = useState<{
    variantId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
  } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const openRepeat = (transfer: TransferPair) => {
    setPreselect({
      variantId: transfer.variantId,
      fromWarehouseId: transfer.fromWarehouseId ?? '',
      toWarehouseId: transfer.toWarehouseId ?? '',
    });
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  // The repeat action needs the variant to still be sellable and both
  // warehouses known — history stays visible without a dead button otherwise.
  const canRepeat = (transfer: TransferPair): boolean =>
    variantOptions.some((v) => v.variantId === transfer.variantId) &&
    transfer.fromWarehouseId !== null &&
    warehouseOptions.some((w) => w.id === transfer.fromWarehouseId) &&
    transfer.toWarehouseId !== null &&
    warehouseOptions.some((w) => w.id === transfer.toWarehouseId);

  const handleTransfer = async (values: TransferStockFormValues) => {
    setError(null);
    setSuccess(null);
    try {
      await transferStock.mutateAsync({
        variantId: values.variantId,
        fromWarehouseId: values.fromWarehouseId,
        toWarehouseId: values.toWarehouseId,
        quantity: values.quantity,
        referenceType: 'manual',
        referenceId: crypto.randomUUID(),
      });
      setSuccess(t('transfers.success'));
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    }
  };

  const warehouseName = (id: string | null): string => {
    if (!id) return '—';
    return warehouseOptions.find((warehouse) => warehouse.id === id)?.name ?? '—';
  };

  return (
    <ModuleGate moduleKey="inventory">
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('transfers.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('transfers.subtitle')}</p>
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

        <div ref={formRef}>
          <TransferForm
            // Remount per preselect so react-hook-form picks up the new
            // default variant/warehouses. The key must include the warehouse
            // pair too — two transfers of the SAME variant between different
            // warehouses would otherwise not re-apply the from/to preselect.
            key={
              preselect
                ? `repeat-${preselect.variantId}-${preselect.fromWarehouseId}-${preselect.toWarehouseId}`
                : 'fresh'
            }
            variants={variantOptions}
            warehouses={warehouseOptions}
            {...(preselect
              ? {
                  initialValues: {
                    variantId: preselect.variantId,
                    fromWarehouseId: preselect.fromWarehouseId,
                    toWarehouseId: preselect.toWarehouseId,
                  },
                }
              : {})}
            onSubmit={handleTransfer}
            pending={transferStock.isPending}
          />
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('transfers.tableDate')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('transfers.tableProduct')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('transfers.tableFrom')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('transfers.tableTo')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('transfers.tableQuantity')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('transfers.tableActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {transfers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        {t('transfers.empty')}
                      </td>
                    </tr>
                  ) : (
                    transfers.map((transfer) => (
                      <tr key={transfer.id} className="transition-colors hover:bg-accent/30">
                        <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-muted-foreground">
                          {new Date(transfer.occurredAt).toLocaleString(locale, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </td>
                        <td className="px-4 py-3 font-medium" dir="auto">
                          {localizedLabel(transfer.nameI18n, locale, transfer.sku)}
                        </td>
                        <td className="px-4 py-3">{warehouseName(transfer.fromWarehouseId)}</td>
                        <td className="px-4 py-3">{warehouseName(transfer.toWarehouseId)}</td>
                        <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">{transfer.quantity}</td>
                        <td className="px-4 py-3 text-end">
                          {canRepeat(transfer) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`${t('transfers.repeat')}: ${transfer.sku}`}
                              onClick={() => openRepeat(transfer)}
                            >
                              <Repeat className="size-4" aria-hidden="true" />
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
      </div>
    </ModuleGate>
  );
}
