'use client';

import { ArrowLeft, RotateCcw, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';
import { Can } from '@/lib/permissions';

import { posErrorKey } from './errors';
import { RefundDialog } from './forms';
import { useCurrencies, useOrgBaseCurrency, usePosMutations, usePosRegisters, usePosSale } from './hooks';
import { localizedLabel } from './labels';
import { formatMinorAmount, prorateRefundAmount } from './money';
import { SaleStatusBadge } from './reports-view';
import type { RefundFormValues } from './schemas';

export function SaleDetailView({ saleId }: { saleId: string }) {
  const t = useTranslations('modules.pos');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, baseCurrency, { locale, exponent });

  const { data: sale, isPending } = usePosSale(saleId);
  const { data: registers } = usePosRegisters();
  const { voidSale, refund } = usePosMutations();

  const [refundOpen, setRefundOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (isPending && !sale) {
    return (
      <ModuleGate moduleKey="pos">
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </ModuleGate>
    );
  }
  if (!sale) return null;

  const register = registers?.items.find((r) => r.id === sale.registerId);
  const registerOptions = (registers?.items ?? []).map((r) => ({ id: r.id, name: r.name, code: r.code }));
  const canRefund = sale.status === 'completed' || sale.status === 'partially_refunded';
  const canVoid = sale.status === 'completed';

  const handleVoid = async () => {
    setError(null);
    setSuccess(null);
    try {
      await voidSale.mutateAsync(saleId);
      setSuccess(t('sale.voidMessage'));
      setVoidOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? posErrorKey(err.code) : t('errors.unknown'));
      setVoidOpen(false);
    }
  };

  const handleRefund = async (values: RefundFormValues) => {
    setError(null);
    setSuccess(null);
    try {
      // The refund schema uses `amountMinor` per line; the API wants the money
      // envelope `{ amountMinor, currency }` (same shape as checkout lines).
      await refund.mutateAsync({
        originalSaleId: saleId,
        registerId: values.registerId,
        reasonCode: values.reasonCode,
        currency: values.currency,
        lines: values.lines.map((line) => ({
          saleLineId: line.saleLineId,
          variantId: line.variantId,
          quantity: line.quantity,
          restock: line.restock,
          amount: { amountMinor: line.amountMinor, currency: line.currency },
          currency: line.currency,
        })),
      });
      setSuccess(t('sale.refundMessage'));
      setRefundOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? posErrorKey(err.code) : t('errors.unknown'));
    }
  };

  return (
    <ModuleGate moduleKey="pos">
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('sale.title')}</h1>
            <p className="mt-1 font-mono text-sm text-muted-foreground">{sale.receiptNumber}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/${locale}/m/pos/reports`}>
                <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
                <span className="ms-1">{t('sale.backToReports')}</span>
              </Link>
            </Button>
            <Can permission="pos:refund:process">
              {canRefund && (
                <Button variant="outline" size="sm" onClick={() => setRefundOpen(true)}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  <span className="ms-1">{t('sale.refund')}</span>
                </Button>
              )}
            </Can>
            <Can permission="pos:sale:create">
              {canVoid && (
                <Button variant="destructive" size="sm" onClick={() => setVoidOpen(true)}>
                  <Undo2 className="size-4" aria-hidden="true" />
                  <span className="ms-1">{t('sale.void')}</span>
                </Button>
              )}
            </Can>
          </div>
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

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{t('sale.status')}</p>
              <div className="mt-1">
                <SaleStatusBadge status={sale.status} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{t('sale.register')}</p>
              <p className="mt-1 font-medium" dir="auto">
                {register?.name ?? sale.registerId}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{t('sale.soldAt')}</p>
              <p className="mt-1">{new Date(sale.soldAt).toLocaleString(locale)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{t('sale.total')}</p>
              <p className="mt-1 font-mono text-xl font-bold tabular-nums">{formatMinor(sale.total.amountMinor)}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('sale.lines')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('sale.tableProduct')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('sale.tableQty')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('sale.tablePrice')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('sale.tableLineTotal')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sale.lines.map((line) => (
                    <tr key={line.id} className="transition-colors hover:bg-accent/30">
                      <td className="max-w-64 px-4 py-3">
                        <p className="truncate" dir="auto">
                          {localizedLabel(line.nameSnapshot, locale)}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">{line.skuSnapshot}</p>
                      </td>
                      <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">{line.quantity}</td>
                      <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                        {formatMinor(line.unitPriceAmountMinor)}
                      </td>
                      <td className="px-4 py-3 text-end font-mono text-xs font-semibold tabular-nums">
                        {formatMinor(line.lineTotalAmountMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t text-sm">
                    <td colSpan={3} className="px-4 py-3 text-end text-muted-foreground">
                      {t('sale.subtotal')}
                    </td>
                    <td className="px-4 py-3 text-end font-mono tabular-nums">
                      {formatMinor(sale.subtotal.amountMinor)}
                    </td>
                  </tr>
                  <tr className="text-sm">
                    <td colSpan={3} className="px-4 py-3 text-end text-muted-foreground">
                      {t('sale.tax')}
                    </td>
                    <td className="px-4 py-3 text-end font-mono tabular-nums">{formatMinor(sale.tax.amountMinor)}</td>
                  </tr>
                  <tr className="border-t bg-muted/40 text-sm font-semibold">
                    <td colSpan={3} className="px-4 py-3 text-end">
                      {t('sale.total')}
                    </td>
                    <td className="px-4 py-3 text-end font-mono tabular-nums">{formatMinor(sale.total.amountMinor)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('sale.payments')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('sale.tableMethod')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('sale.tableReference')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('sale.tableTendered')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('sale.tableChange')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('sale.tableAmount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sale.payments.map((payment) => (
                    <tr key={payment.id} className="transition-colors hover:bg-accent/30">
                      <td className="px-4 py-3">{t(`sale.method.${payment.method}`)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{payment.reference ?? '—'}</td>
                      <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                        {payment.tenderedAmountMinor ? formatMinor(payment.tenderedAmountMinor) : '—'}
                      </td>
                      <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                        {formatMinor(payment.changeAmountMinor)}
                      </td>
                      <td className="px-4 py-3 text-end font-mono text-xs font-semibold tabular-nums">
                        {formatMinor(payment.amountMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <ConfirmDialog
          open={voidOpen}
          title={t('sale.voidConfirmTitle')}
          description={t('sale.voidConfirmBody', { receipt: sale.receiptNumber })}
          confirmLabel={t('sale.void')}
          cancelLabel={t('sale.cancel')}
          closeLabel={t('sale.close')}
          destructive
          loading={voidSale.isPending}
          onConfirm={() => void handleVoid()}
          onCancel={() => setVoidOpen(false)}
        />

        <RefundDialog
          open={refundOpen}
          onClose={() => setRefundOpen(false)}
          registers={registerOptions}
          currency={baseCurrency}
          defaultRegisterId={sale.registerId}
          refundableLines={sale.lines.map((line) => ({
            saleLineId: line.id,
            variantId: line.variantId,
            skuSnapshot: line.skuSnapshot,
            nameSnapshot: line.nameSnapshot,
            quantity: line.quantity,
            amountMinor: prorateRefundAmount(line.lineTotalAmountMinor, line.quantity, line.quantity),
          }))}
          onSubmit={handleRefund}
          pending={refund.isPending}
        />
      </div>
    </ModuleGate>
  );
}
