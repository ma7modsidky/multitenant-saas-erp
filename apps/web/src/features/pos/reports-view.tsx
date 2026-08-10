'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { POS_PAGE_SIZE } from '@/lib/api/resources';
import { ModuleGate } from '@/lib/entitlements';
import { Can } from '@/lib/permissions';

import { useCurrencies, useOrgBaseCurrency, usePosSales } from './hooks';
import { formatMinorAmount } from './money';

const SALE_STATUS: string[] = ['completed', 'partially_refunded', 'refunded', 'voided'];

/** Revenue semantics shared with the dashboard's Revenue (MTD) stat (POS-13). */
const REVENUE_STATUSES = 'completed,partially_refunded';

export function ReportsView() {
  const t = useTranslations('modules.pos');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, baseCurrency, { locale, exponent });

  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  // Default (no status param) is the REVENUE view — completed + partially
  // refunded only, the same semantics as the dashboard's Revenue (MTD) stat.
  // `all` opts back into every status (the audit view); anything else is a
  // single POS-13 status. The API accepts the comma-separated status list.
  const apiStatus = status === 'all' ? undefined : status === '' ? REVENUE_STATUSES : status;

  const basePath = `/${locale}/m/pos/reports`;

  const setParam = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
  };

  const hasActiveFilters = Boolean(status || from || to);

  const { data: sales, isPending } = usePosSales({
    page,
    pageSize: POS_PAGE_SIZE,
    ...(apiStatus ? { status: apiStatus } : {}),
    ...(from ? { fromDate: from } : {}),
    ...(to ? { toDate: to } : {}),
  });

  const pages = Math.max(1, Math.ceil((sales?.total ?? 0) / POS_PAGE_SIZE));

  return (
    <ModuleGate moduleKey="pos">
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('reports.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('reports.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Select
            value={status}
            onValueChange={(value) => setParam({ status: value, page: '' })}
            className="w-48"
            aria-label={t('reports.filterStatus')}
          >
            <SelectItem value="">{t('reports.activeSales')}</SelectItem>
            <SelectItem value="all">{t('reports.allStatuses')}</SelectItem>
            {SALE_STATUS.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`reports.status.${s}`)}
              </SelectItem>
            ))}
          </Select>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('reports.fromDate')}</Label>
            <Input
              type="date"
              value={from}
              onChange={(event) => setParam({ from: event.target.value, page: '' })}
              className="h-9"
              aria-label={t('reports.fromDate')}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('reports.toDate')}</Label>
            <Input
              type="date"
              value={to}
              onChange={(event) => setParam({ to: event.target.value, page: '' })}
              className="h-9"
              aria-label={t('reports.toDate')}
            />
          </div>
          {/* Reset returns to the DEFAULT (revenue) view — so from `all` it
              hides refunded/voided rows again; the dropdown shows the state. */}
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={() => setParam({ status: '', from: '', to: '', page: '' })}>
              <X aria-hidden="true" />
              <span className="ms-1">{t('list.resetFilters')}</span>
            </Button>
          )}
        </div>

        {/* Exact totals of the FILTERED set (server-side Σ, not this page) —
            only once the list has data to avoid a 0/$0.00 line while loading.
            Net = total − refunds (BigInt integer math, hard rule #3). */}
        {!isPending && (
          <p className="text-sm text-muted-foreground">
            {t('reports.summary', {
              count: sales?.total ?? 0,
              total: formatMinor(sales?.totalAmountMinor ?? '0'),
              refunds: formatMinor(sales?.refundsAmountMinor ?? '0'),
              net: formatMinor(
                (BigInt(sales?.totalAmountMinor ?? '0') - BigInt(sales?.refundsAmountMinor ?? '0')).toString(),
              ),
            })}
          </p>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('reports.tableReceipt')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('reports.tableStatus')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('reports.tableSoldAt')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('reports.tableTotal')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('reports.tableActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isPending && !sales ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        {t('common.loading')}
                      </td>
                    </tr>
                  ) : (sales?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        {t('reports.empty')}
                      </td>
                    </tr>
                  ) : (
                    sales?.items.map((sale) => (
                      <tr key={sale.id} className="transition-colors hover:bg-accent/30">
                        <td className="px-4 py-3 font-mono text-xs">
                          <Link
                            href={`/${locale}/m/pos/sales/${sale.id}`}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {sale.receiptNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <SaleStatusBadge status={sale.status} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(sale.soldAt).toLocaleString(locale)}
                        </td>
                        <td className="px-4 py-3 text-end font-mono font-semibold tabular-nums">
                          {formatMinor(sale.total.amountMinor)}
                        </td>
                        <td className="px-4 py-3 text-end">
                          <Can permission="pos:report:view">
                            <Button asChild variant="ghost" size="sm">
                              <Link href={`/${locale}/m/pos/sales/${sale.id}`}>{t('reports.view')}</Link>
                            </Button>
                          </Can>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="ms-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isPending}
              onClick={() => setParam({ page: String(page - 1) })}
            >
              <ChevronLeft className="rtl:rotate-180" aria-hidden="true" />
              {t('list.previous')}
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">{t('list.pageOf', { page, pages })}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages || isPending}
              onClick={() => setParam({ page: String(page + 1) })}
            >
              {t('list.next')}
              <ChevronRight className="rtl:rotate-180" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </ModuleGate>
  );
}

export function SaleStatusBadge({ status }: { status: string }) {
  const t = useTranslations('modules.pos');
  const variant =
    status === 'completed'
      ? 'secondary'
      : status === 'partially_refunded'
        ? 'outline'
        : status === 'refunded'
          ? 'outline'
          : 'destructive';
  return <Badge variant={variant}>{t(`reports.status.${status}`)}</Badge>;
}
