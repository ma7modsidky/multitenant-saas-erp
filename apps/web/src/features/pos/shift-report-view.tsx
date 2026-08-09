'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ModuleGate } from '@/lib/entitlements';
import { useMemberName } from '@/lib/hooks/use-member-name';

import { useCurrencies, useOrgBaseCurrency, usePosRegisters, usePosShiftReport } from './hooks';
import { formatMinorAmount, subtractMinorAmounts } from './money';

export function ShiftReportView({ shiftId }: { shiftId: string }) {
  const t = useTranslations('modules.pos');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string | null) =>
    amountMinor === null ? '—' : formatMinorAmount(amountMinor, baseCurrency, { locale, exponent });

  const { data: report, isPending } = usePosShiftReport(shiftId);
  const { data: registers } = usePosRegisters();
  const memberName = useMemberName();
  const [tab, setTab] = useState<'sales' | 'refunds'>('sales');

  if (isPending && !report) {
    return (
      <ModuleGate moduleKey="pos">
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </ModuleGate>
    );
  }
  if (!report) return null;

  const register = registers?.items.find((r) => r.id === report.shift.registerId);
  const varianceMinor = report.shift.varianceAmountMinor ?? '0';
  const varianceAbs = subtractMinorAmounts(varianceMinor, '0');

  return (
    <ModuleGate moduleKey="pos">
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('report.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {register ? `${register.name} (${register.code})` : report.shift.registerId}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${locale}/m/pos/shifts`}>
              <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
              <span className="ms-1">{t('report.backToShifts')}</span>
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{t('report.salesTotal')}</p>
              <p className="mt-1 font-mono text-xl font-bold tabular-nums">
                {formatMinor(report.totals.salesAmountMinor)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{t('report.refundsTotal')}</p>
              <p className="mt-1 font-mono text-xl font-bold tabular-nums">
                {formatMinor(report.totals.refundsAmountMinor)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{t('report.netTotal')}</p>
              <p className="mt-1 font-mono text-xl font-bold tabular-nums">
                {formatMinor(report.totals.netAmountMinor)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{t('report.variance')}</p>
              <p
                className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                  BigInt(varianceMinor) >= 0n ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
                }`}
              >
                {BigInt(varianceMinor) >= 0n ? '+' : ''}
                {formatMinor(varianceAbs)}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('report.shiftDetails')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('report.openedBy')}</span>
              <span dir="auto">{memberName(report.shift.openedBy) ?? report.shift.openedBy}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('report.openedAt')}</span>
              <span>{new Date(report.shift.openedAt).toLocaleString(locale)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('report.openingFloat')}</span>
              <span className="font-mono tabular-nums">{formatMinor(report.shift.openingFloatAmountMinor)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('report.countedCash')}</span>
              <span className="font-mono tabular-nums">{formatMinor(report.shift.countedCashAmountMinor)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('report.expectedCash')}</span>
              <span className="font-mono tabular-nums">{formatMinor(report.shift.expectedCashAmountMinor)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('report.closedBy')}</span>
              <span dir="auto">
                {report.shift.closedBy ? (memberName(report.shift.closedBy) ?? report.shift.closedBy) : '—'}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('report.closedAt')}</span>
              <span>{report.shift.closedAt ? new Date(report.shift.closedAt).toLocaleString(locale) : '—'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('report.status')}</span>
              <span>
                {report.shift.status === 'open' ? (
                  <Badge variant="secondary">{t('shifts.statusOpen')}</Badge>
                ) : (
                  <Badge variant="outline">{t('shifts.statusClosed')}</Badge>
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">{tab === 'sales' ? t('report.sales') : t('report.refunds')}</CardTitle>
            <div className="flex gap-1">
              <Button
                variant={tab === 'sales' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={tab === 'sales'}
                onClick={() => setTab('sales')}
              >
                {t('report.sales')}
              </Button>
              <Button
                variant={tab === 'refunds' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={tab === 'refunds'}
                onClick={() => setTab('refunds')}
              >
                {t('report.refunds')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('report.tableReceipt')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('report.tableItems')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('report.tableAmount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tab === 'sales' &&
                    (report.sales.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                          {t('report.noSales')}
                        </td>
                      </tr>
                    ) : (
                      report.sales.map((sale) => (
                        <tr key={sale.id} className="transition-colors hover:bg-accent/30">
                          <td className="px-4 py-3 font-mono text-xs">
                            <Link
                              href={`/${locale}/m/pos/sales/${sale.id}`}
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              {sale.receiptNumber}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{sale.lines.length}</td>
                          <td className="px-4 py-3 text-end font-mono tabular-nums">
                            {formatMinor(sale.total.amountMinor)}
                          </td>
                        </tr>
                      ))
                    ))}
                  {tab === 'refunds' &&
                    (report.refunds.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                          {t('report.noRefunds')}
                        </td>
                      </tr>
                    ) : (
                      report.refunds.map((refund) => (
                        <tr key={refund.id} className="transition-colors hover:bg-accent/30">
                          <td className="px-4 py-3 font-mono text-xs">{refund.id.slice(0, 8)}</td>
                          <td className="px-4 py-3 text-muted-foreground" dir="auto">
                            {refund.reasonCode}
                          </td>
                          <td className="px-4 py-3 text-end font-mono tabular-nums">
                            {formatMinor(refund.amount.amountMinor)}
                          </td>
                        </tr>
                      ))
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ModuleGate>
  );
}
