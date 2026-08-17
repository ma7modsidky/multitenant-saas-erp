'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Eye, Wallet } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { ModuleGate } from '@/lib/entitlements';

import type { AccountingPayment } from '@/lib/api/resources';

import { useAccountingPayments, useCurrencies, useOrgBaseCurrency } from './hooks';
import { formatMinorAmount } from './labels';
import { AccountingPageHeader } from './page-header';

const PAYMENT_METHODS: ReadonlyArray<AccountingPayment['method']> = [
  'cash',
  'bank_transfer',
  'card',
  'cheque',
  'other',
];

const PAGE_SIZE = 20;

/**
 * PaymentsView — every payment receipt (ACC-9): the amount, method, the
 * invoice it was allocated to, and the customer. Filters by method and a
 * received-at date range; paginated server-side. The ledger is append-only —
 * receipts are never edited or deleted here.
 */
export function PaymentsView() {
  const t = useTranslations('modules.accounting');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string, currency = baseCurrency) =>
    formatMinorAmount(amountMinor, currency, { locale, exponent });

  const [q, setQ] = useState('');
  const [method, setMethod] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  // Committed filter state — the free-text input only takes effect on Apply.
  const [range, setRange] = useState<{ q?: string; method?: string; fromDate?: string; toDate?: string }>({});
  const [page, setPage] = useState(1);

  const { data, isPending } = useAccountingPayments({
    ...(range.q ? { q: range.q } : {}),
    ...(range.method ? { method: range.method } : {}),
    ...(range.fromDate ? { fromDate: range.fromDate } : {}),
    ...(range.toDate ? { toDate: range.toDate } : {}),
    page,
    pageSize: PAGE_SIZE,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const applyFilters = () => {
    setPage(1);
    setRange({
      ...(q.trim() !== '' ? { q: q.trim() } : {}),
      ...(method ? { method } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
    });
  };

  const clearFilters = () => {
    setQ('');
    setMethod('');
    setFromDate('');
    setToDate('');
    setRange({});
    setPage(1);
  };

  return (
    <ModuleGate moduleKey="accounting">
      <div className="space-y-6 animate-fade-in">
        <AccountingPageHeader icon={Wallet} title={t('payments.title')} subtitle={t('payments.subtitle')} />

        {/* Filters — search (customer/invoice) + method + received-at range. */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="payments-search">{t('payments.search')}</Label>
            <Input
              id="payments-search"
              type="search"
              dir="auto"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={t('payments.searchPlaceholder')}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="payments-method">{t('payments.method')}</Label>
            <Select
              id="payments-method"
              value={method}
              onValueChange={(value) => {
                setMethod(value);
                setPage(1);
              }}
            >
              <SelectItem value="">{t('payments.allMethods')}</SelectItem>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {t(`payments.methods.${m}`)}
                </SelectItem>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="payments-from">{t('payments.fromDate')}</Label>
            <Input
              id="payments-from"
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="payments-to">{t('payments.toDate')}</Label>
            <Input id="payments-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </div>
          <Button size="sm" onClick={applyFilters}>
            {t('payments.apply')}
          </Button>
          {Object.keys(range).length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              {t('payments.clear')}
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('payments.tableDate')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('payments.tableMethod')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('payments.tableInvoice')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('payments.tableCustomer')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('payments.tableReference')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('payments.tableAmount')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('payments.tableActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isPending && !data ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        {t('common.loading')}
                      </td>
                    </tr>
                  ) : (data?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        {t('payments.empty')}
                      </td>
                    </tr>
                  ) : (
                    data?.items.map((payment) => (
                      <tr key={payment.id} className="transition-colors hover:bg-accent/30">
                        <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-muted-foreground">
                          {new Date(payment.receivedAt).toLocaleDateString(locale)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline">{t(`payments.methods.${payment.method}`)}</Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          <Link
                            href={`/${locale}/m/accounting/invoices/${payment.invoiceId}`}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {payment.invoiceNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-medium" dir="auto">
                          {payment.customerNameSnapshot}
                        </td>{' '}
                        <td
                          className="max-w-[12rem] truncate px-4 py-3 text-end text-xs text-muted-foreground"
                          dir="auto"
                        >
                          {payment.reference || '—'}
                        </td>
                        <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                          {formatMinor(payment.amountMinor, payment.currency)}
                        </td>
                        <td className="px-4 py-3 text-end">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/${locale}/m/accounting/payments/${payment.id}`}>
                              <Eye className="size-4" aria-hidden="true" />
                              <span className="ms-1">{t('payments.viewReceipt')}</span>
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Pagination — prev/next with the shown/total count. */}
        {data && data.total > data.pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {t('payments.shownCount', {
                from: String((data.page - 1) * data.pageSize + 1),
                to: String(Math.min(data.page * data.pageSize, data.total)),
                total: String(data.total),
              })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t('payments.previous')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t('payments.pageOf', { page: String(data.page), total: String(totalPages) })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t('payments.next')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ModuleGate>
  );
}
