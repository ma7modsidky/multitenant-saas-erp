'use client';

import { ArrowLeft, Download, PackageCheck, Printer } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ModuleGate } from '@/lib/entitlements';

import { useCurrencies, useOrgBaseCurrency, usePurchasingGrn, usePurchasingPurchaseOrder } from './hooks';
import { formatMinorAmount, formatQuantity, statusTone } from './labels';
import { PurchasingPageHeader } from './page-header';

/** GRN line value = quantity × unit cost, exact integer math (×10⁴ qty). */
function lineAmountMinor(quantity: string, unitCostMinor: string): string {
  const [whole = '0', frac = '0'] = quantity.split('.');
  const fracPadded = frac.padEnd(4, '0').slice(0, 4);
  const scaled = BigInt(whole) * 10000n + BigInt(fracPadded);
  return ((BigInt(unitCostMinor) * scaled + 5000n) / 10000n).toString();
}

/**
 * GrnDetailView — one goods received note (PUR-4/5): the received document with
 * item names resolved from the referenced PO, and the receive timestamp. GRNs
 * are immutable once received; the Print / Export PDF actions use the print
 * layout (the browser dialog's Save-as-PDF is the PDF destination).
 */
export function GrnDetailView({ grnId }: { grnId: string }) {
  const t = useTranslations('modules.purchasing');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;

  const { data, isPending } = usePurchasingGrn(grnId);
  const { data: po } = usePurchasingPurchaseOrder(data?.poId ?? '');

  if (isPending && !data)
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (!data) return <p className="py-10 text-center text-sm text-destructive">{t('errors.notFound')}</p>;

  const grn = data;
  const currency = grn.lines[0]?.unitCostCurrency ?? baseCurrency;
  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, currency, { locale, exponent });
  const poLines = po?.lines ?? [];
  const totalMinor = grn.lines
    .reduce((sum, line) => sum + BigInt(lineAmountMinor(line.quantity, line.unitCostMinor)), 0n)
    .toString();

  const DetailField = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm" dir="auto">
        {value}
      </dd>
    </div>
  );

  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5 animate-fade-in">
        <PurchasingPageHeader
          icon={PackageCheck}
          title={grn.number}
          subtitle={`${grn.supplierNameSnapshot} · ${t(`receiving.statuses.${grn.status}`)}`}
          actions={
            <>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer className="size-4" aria-hidden="true" />
                  <span className="ms-1">{t('receiving.print')}</span>
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  <Download className="size-4" aria-hidden="true" />
                  <span className="ms-1">{t('receiving.exportPdf')}</span>
                </Button>
              </div>
              <Button asChild variant="outline">
                <Link href="/m/purchasing/receiving">
                  <ArrowLeft />
                  {t('common.back')}
                </Link>
              </Button>
            </>
          }
        />

        {/* Document header — who received what from which PO (printable). */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('receiving.document')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DetailField label={t('receiving.supplier')} value={grn.supplierNameSnapshot} />
              <DetailField
                label={t('receiving.po')}
                value={
                  <Link
                    href={`/${locale}/m/purchasing/purchase-orders/${grn.poId}`}
                    className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  >
                    {grn.poNumber}
                  </Link>
                }
              />
              <DetailField
                label={t('receiving.receivedAt')}
                value={
                  grn.receivedAt
                    ? new Date(grn.receivedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
                    : '—'
                }
              />
              <DetailField label={t('receiving.currency')} value={currency} />
            </dl>
          </CardContent>
        </Card>

        {/* Received lines, item names resolved from the PO. */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t('receiving.linesTitle')}</CardTitle>
            <Badge variant={statusTone(grn.status)}>{t(`receiving.statuses.${grn.status}`)}</Badge>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('receiving.item')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('receiving.quantity')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('receiving.unitCost')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('receiving.lineTotal')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {grn.lines.map((line) => (
                    <tr key={line.id} className="transition-colors hover:bg-accent/30">
                      <td className="px-4 py-3 font-medium" dir="auto">
                        {poLines.find((p) => p.id === line.poLineId)?.itemNameSnapshot ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-end font-mono text-xs">{formatQuantity(line.quantity)}</td>
                      <td className="px-4 py-3 text-end font-mono text-xs">{formatMinor(line.unitCostMinor)}</td>
                      <td className="px-4 py-3 text-end font-mono text-xs font-semibold">
                        {formatMinor(lineAmountMinor(line.quantity, line.unitCostMinor))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t text-sm">
                    <td colSpan={3} className="px-4 py-2 text-end font-medium text-muted-foreground">
                      {t('receiving.total')}
                    </td>
                    <td className="px-4 py-2 text-end font-mono text-xs font-semibold">{formatMinor(totalMinor)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ModuleGate>
  );
}
