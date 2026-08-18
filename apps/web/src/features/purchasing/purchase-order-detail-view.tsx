'use client';

import { ArrowLeft, CheckCircle2, FileText } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';

import { usePurchasingError } from './errors';
import { useCurrencies, useOrgBaseCurrency, usePurchasingMutations, usePurchasingPurchaseOrder } from './hooks';
import { formatMinorAmount, formatQuantity, statusTone } from './labels';
import { PurchasingPageHeader } from './page-header';

/** PurchaseOrderDetailView — header + itemized lines (PUR-8) + approve action. */
export function PurchaseOrderDetailView({ poId }: { poId: string }) {
  const t = useTranslations('modules.purchasing');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const { data, isPending } = usePurchasingPurchaseOrder(poId);
  const { approvePurchaseOrder } = usePurchasingMutations();
  const errorKey = usePurchasingError();
  const [error, setError] = useState<string | null>(null);

  const currency = data?.currency ?? baseCurrency;
  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, currency, { locale, exponent });

  const onApprove = async () => {
    setError(null);
    try {
      await approvePurchaseOrder.mutateAsync(poId);
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : undefined));
    }
  };

  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5">
        <PurchasingPageHeader
          icon={FileText}
          title={data?.number ?? t('purchaseOrders.detailTitle')}
          subtitle={data ? `${data.supplierNameSnapshot} · ${t(`purchaseOrders.statuses.${data.status}`)}` : ''}
          actions={
            <>
              {data?.status === 'draft' && (
                <Button onClick={() => void onApprove()} disabled={approvePurchaseOrder.isPending}>
                  <CheckCircle2 />
                  {t('purchaseOrders.approve')}
                </Button>
              )}
              <Button asChild variant="outline">
                <Link href="/m/purchasing/purchase-orders">
                  <ArrowLeft />
                  {t('common.back')}
                </Link>
              </Button>
            </>
          }
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('purchaseOrders.lines')}</CardTitle>
            {data && <Badge variant={statusTone(data.status)}>{t(`purchaseOrders.statuses.${data.status}`)}</Badge>}
          </CardHeader>
          <CardContent>
            {isPending ? (
              <p className="py-8 text-center text-muted-foreground">{t('common.loading')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-start text-muted-foreground">
                      <th className="py-2 pe-4 text-start font-medium">{t('purchaseOrders.item')}</th>
                      <th className="py-2 pe-4 text-end font-medium">{t('purchaseOrders.quantity')}</th>
                      <th className="py-2 pe-4 text-end font-medium">{t('purchaseOrders.received')}</th>
                      <th className="py-2 pe-4 text-end font-medium">{t('purchaseOrders.unitCost')}</th>
                      <th className="py-2 text-end font-medium">{t('purchaseOrders.lineTotal')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.lines ?? []).map((line) => (
                      <tr key={line.id} className="border-b">
                        <td className="py-2 pe-4">{line.itemNameSnapshot}</td>
                        <td className="py-2 pe-4 text-end">{formatQuantity(line.quantity)}</td>
                        <td className="py-2 pe-4 text-end">{formatQuantity(line.receivedQuantity)}</td>
                        <td className="py-2 pe-4 text-end">{formatMinor(line.unitCostMinor)}</td>
                        <td className="py-2 text-end">{formatMinor(line.lineTotalMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {data && (
                    <tfoot>
                      <tr className="border-t font-medium">
                        <td colSpan={4} className="py-2 pe-4 text-end">
                          {t('purchaseOrders.total')}
                        </td>
                        <td className="py-2 text-end">{formatMinor(data.totalMinor)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ModuleGate>
  );
}
