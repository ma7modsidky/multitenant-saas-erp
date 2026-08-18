'use client';

import { PackageCheck, Plus } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';

import type { PurchasingGrn, PurchasingPurchaseOrderDetail } from '@/lib/api/resources';

import { usePurchasingError } from './errors';
import {
  useCurrencies,
  useOrgBaseCurrency,
  usePurchasingGrns,
  usePurchasingMutations,
  usePurchasingPurchaseOrders,
} from './hooks';
import { formatQuantity, statusTone } from './labels';
import { PurchasingPageHeader } from './page-header';

const PAGE_SIZE = 20;

/**
 * GrnsView — goods received notes (PUR-4/5). Receiving selects an approved PO
 * and records the received quantity per line; stock raises atomically
 * server-side. Received GRNs are immutable (PUR-5).
 */
export function GrnsView() {
  const t = useTranslations('modules.purchasing');
  const locale = useLocale();
  void useCurrencies();
  void useOrgBaseCurrency();

  const [q, setQ] = useState('');
  const [range, setRange] = useState<{ q?: string }>({});
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data, isPending } = usePurchasingGrns({ ...(range.q ? { q: range.q } : {}), page, pageSize: PAGE_SIZE });
  const { data: posData } = usePurchasingPurchaseOrders({ status: 'approved', pageSize: 200 });
  const { receiveGrn } = usePurchasingMutations();
  const errorKey = usePurchasingError();

  const [selectedPoId, setSelectedPoId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  const selectedPo: PurchasingPurchaseOrderDetail | undefined = posData?.items.find((po) => po.id === selectedPoId);

  const onReceive = async () => {
    setError(null);
    setSuccess(null);
    if (!selectedPoId) return;
    try {
      const lines = (selectedPo?.lines ?? []).map((line) => ({
        poLineId: line.id,
        variantId: line.variantId,
        quantity: quantities[line.id] ?? line.quantity,
        unitCostMinor: line.unitCostMinor,
        unitCostCurrency: line.unitCostCurrency,
      }));
      await receiveGrn.mutateAsync({ poId: selectedPoId, lines });
      setSuccess(t('receiving.receivedMessage'));
      setFormOpen(false);
      setSelectedPoId('');
      setQuantities({});
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : undefined));
    }
  };

  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5">
        <PurchasingPageHeader
          icon={PackageCheck}
          title={t('receiving.title')}
          subtitle={t('receiving.subtitle')}
          actions={
            <Button variant="outline" onClick={() => setFormOpen((open) => !open)}>
              <Plus />
              {formOpen ? t('common.hideForm') : t('receiving.addAction')}
            </Button>
          }
        />

        {formOpen && (
          <Card>
            <CardHeader>
              <CardTitle>{t('receiving.addTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="grn-po">{t('receiving.po')}</Label>
                <Select value={selectedPoId} onValueChange={setSelectedPoId}>
                  <SelectItem value="">{t('receiving.selectPo')}</SelectItem>
                  {(posData?.items ?? []).map((po) => (
                    <SelectItem key={po.id} value={po.id}>
                      {po.number} · {po.supplierNameSnapshot}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              {selectedPo && (
                <div className="space-y-2">
                  <Label>{t('receiving.lines')}</Label>
                  {selectedPo.lines.map((line) => (
                    <div key={line.id} className="grid gap-2 sm:grid-cols-[1fr_120px_90px]">
                      <div className="flex items-center gap-2 text-sm">
                        <span>{line.itemNameSnapshot}</span>
                        <span className="text-muted-foreground">
                          {t('receiving.remaining', {
                            received: formatQuantity(line.receivedQuantity),
                            ordered: formatQuantity(line.quantity),
                          })}
                        </span>
                      </div>
                      <Input
                        type="number"
                        step="any"
                        value={quantities[line.id] ?? line.quantity}
                        onChange={(event) => setQuantities((prev) => ({ ...prev, [line.id]: event.target.value }))}
                      />
                      <span className="flex items-center text-sm text-muted-foreground">{line.unitCostCurrency}</span>
                    </div>
                  ))}
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
              {success && <p className="text-sm text-emerald-600">{success}</p>}
              <div className="flex justify-end">
                <Button onClick={() => void onReceive()} disabled={!selectedPoId || receiveGrn.isPending}>
                  {t('receiving.submit')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row">
              <Input
                placeholder={t('receiving.searchPlaceholder')}
                value={q}
                onChange={(event) => setQ(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setRange({ q });
                    setPage(1);
                  }
                }}
                className="sm:max-w-xs"
              />
              <Button
                variant="outline"
                onClick={() => {
                  setRange({ q });
                  setPage(1);
                }}
              >
                {t('common.apply')}
              </Button>
            </div>

            {isPending ? (
              <p className="py-8 text-center text-muted-foreground">{t('common.loading')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-start text-muted-foreground">
                      <th className="py-2 pe-4 text-start font-medium">{t('receiving.number')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('receiving.po')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('receiving.supplier')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('receiving.status')}</th>
                      <th className="py-2 text-start font-medium">{t('receiving.receivedAt')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.items ?? []).map((grn: PurchasingGrn) => (
                      <tr key={grn.id} className="border-b">
                        <td className="py-2 pe-4 font-medium">
                          <Link href={`/m/purchasing/receiving/${grn.id}`} className="text-primary hover:underline">
                            {grn.number}
                          </Link>
                        </td>
                        <td className="py-2 pe-4">{grn.poNumber}</td>
                        <td className="py-2 pe-4">{grn.supplierNameSnapshot}</td>
                        <td className="py-2 pe-4">
                          <Badge variant={statusTone(grn.status)}>{t(`receiving.statuses.${grn.status}`)}</Badge>
                        </td>
                        <td className="py-2">
                          {grn.receivedAt ? new Date(grn.receivedAt).toLocaleDateString(locale) : '—'}
                        </td>
                      </tr>
                    ))}
                    {(data?.items ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                          {t('receiving.empty')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {data && data.total > PAGE_SIZE && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {t('common.pageOf', { page: data.page, total: Math.ceil(data.total / PAGE_SIZE) })}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    {t('common.previous')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= Math.ceil(data.total / PAGE_SIZE)}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('common.next')}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ModuleGate>
  );
}
