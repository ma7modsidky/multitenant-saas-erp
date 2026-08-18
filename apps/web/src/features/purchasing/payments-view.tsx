'use client';

import { Wallet } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { ModuleGate } from '@/lib/entitlements';

import type { PurchasingPayment } from '@/lib/api/resources';

import { useCurrencies, useOrgBaseCurrency, usePurchasingPayments } from './hooks';
import { formatMinorAmount } from './labels';
import { PurchasingPageHeader } from './page-header';

const PAGE_SIZE = 20;
const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'cheque', 'other'];

/**
 * PaymentsView — supplier payment disbursements (PUR-7): amount, method,
 * supplier, and the bills it settled. Search by customer/invoice + method
 * filter; paginated server-side.
 */
export function PaymentsView() {
  const t = useTranslations('modules.purchasing');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string, currency = baseCurrency) =>
    formatMinorAmount(amountMinor, currency, { locale, exponent });

  const [q, setQ] = useState('');
  const [method, setMethod] = useState('');
  const [range, setRange] = useState<{ q?: string; method?: string }>({});
  const [page, setPage] = useState(1);

  const { data, isPending } = usePurchasingPayments({
    ...(range.q ? { q: range.q } : {}),
    ...(range.method ? { method: range.method } : {}),
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5">
        <PurchasingPageHeader icon={Wallet} title={t('payments.title')} subtitle={t('payments.subtitle')} />

        <Card>
          <CardContent className="pt-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row">
              <Input
                placeholder={t('payments.searchPlaceholder')}
                value={q}
                onChange={(event) => setQ(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setRange({ q, method });
                    setPage(1);
                  }
                }}
                className="sm:max-w-xs"
              />
              <Select value={method} onValueChange={setMethod}>
                <SelectItem value="">{t('payments.filterAll')}</SelectItem>
                {PAYMENT_METHODS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`payments.methods.${value}`)}
                  </SelectItem>
                ))}
              </Select>
              <Button
                variant="outline"
                onClick={() => {
                  setRange({ q, method });
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
                      <th className="py-2 pe-4 text-start font-medium">{t('payments.number')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('payments.supplier')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('payments.method')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('payments.date')}</th>
                      <th className="py-2 text-end font-medium">{t('payments.amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.items ?? []).map((payment: PurchasingPayment) => (
                      <tr key={payment.id} className="border-b">
                        <td className="py-2 pe-4">
                          <a
                            href={`/m/purchasing/payments/${payment.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {payment.number}
                          </a>
                        </td>
                        <td className="py-2 pe-4">{payment.supplierNameSnapshot}</td>
                        <td className="py-2 pe-4">{t(`payments.methods.${payment.method}`)}</td>
                        <td className="py-2 pe-4">{new Date(payment.paidAt).toLocaleDateString(locale)}</td>
                        <td className="py-2 text-end">{formatMinor(payment.amountMinor, payment.currency)}</td>
                      </tr>
                    ))}
                    {(data?.items ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                          {t('payments.empty')}
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
