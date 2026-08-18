'use client';

import { ArrowLeft, Banknote, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ModuleGate } from '@/lib/entitlements';

import type { PurchasingPaymentDetail } from '@/lib/api/resources';

import { useAccountingJournalBySource, useCurrencies, useOrgBaseCurrency, usePurchasingPayment } from './hooks';
import { formatMinorAmount } from './labels';
import { PurchasingPageHeader } from './page-header';

/**
 * PaymentDetailView — one cash disbursement with its allocation breakdown
 * across bills (PUR-7). The payment itself is immutable once recorded; the
 * allocations show exactly which bills were settled and by how much.
 */
export function PaymentDetailView({ paymentId }: { paymentId: string }) {
  const t = useTranslations('modules.purchasing');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const { data, isPending } = usePurchasingPayment(paymentId);

  // The cash-disbursement entry accounting posted when the payment was recorded.
  const journalEntry = useAccountingJournalBySource('supplier_payment', paymentId).data;
  const journalHref = journalEntry ? `/${locale}/m/accounting/journal?entry=${journalEntry.id}` : null;

  const payment: PurchasingPaymentDetail | undefined = data;
  const currency = payment?.currency ?? baseCurrency;
  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, currency, { locale, exponent });

  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5">
        <PurchasingPageHeader
          icon={Banknote}
          title={payment?.number ?? t('payments.detailTitle')}
          subtitle={payment ? `${payment.supplierNameSnapshot} · ${t(`payments.methods.${payment.method}`)}` : ''}
          actions={
            <>
              {journalEntry && journalHref && (
                <Button asChild variant="outline">
                  <Link href={journalHref}>
                    <BookOpen />
                    {t('payments.viewJournalEntry', {
                      entry: `JE-${String(journalEntry.entryNumber).padStart(4, '0')}`,
                    })}
                  </Link>
                </Button>
              )}
              <Button asChild variant="outline">
                <Link href="/m/purchasing/payments">
                  <ArrowLeft />
                  {t('common.back')}
                </Link>
              </Button>
            </>
          }
        />

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>{t('payments.summaryTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('payments.method')}</span>
                <Badge variant="outline">{payment ? t(`payments.methods.${payment.method}`) : '—'}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('payments.date')}</span>
                <span>{payment?.paidAt ? new Date(payment.paidAt).toLocaleDateString(locale) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('payments.reference')}</span>
                <span>{payment?.reference ?? '—'}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-medium">
                <span>{t('payments.amount')}</span>
                <span>{payment ? formatMinor(payment.amountMinor) : '—'}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t('payments.allocationsTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isPending ? (
                <p className="py-8 text-center text-muted-foreground">{t('common.loading')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start text-muted-foreground">
                        <th className="py-2 pe-4 text-start font-medium">{t('payments.bill')}</th>
                        <th className="py-2 text-end font-medium">{t('payments.allocatedAmount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(payment?.allocations ?? []).map((allocation) => (
                        <tr key={allocation.id} className="border-b">
                          <td className="py-2 pe-4">
                            <Link
                              href={`/m/purchasing/bills/${allocation.billId}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {allocation.billNumber}
                            </Link>
                          </td>
                          <td className="py-2 text-end">{formatMinor(allocation.amountMinor)}</td>
                        </tr>
                      ))}
                      {(payment?.allocations ?? []).length === 0 && (
                        <tr>
                          <td colSpan={2} className="py-8 text-center text-muted-foreground">
                            {t('payments.empty')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </ModuleGate>
  );
}
