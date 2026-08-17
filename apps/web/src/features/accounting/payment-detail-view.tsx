'use client';

import { ArrowLeft, BookOpen, FileText, Printer } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ModuleGate } from '@/lib/entitlements';
import { useMemberName } from '@/lib/hooks/use-member-name';

import { useAccountingPayment, useCurrencies, useOrgBaseCurrency } from './hooks';
import { JournalEntryDetailModal } from './journal-entry-detail-modal';
import { formatMinorAmount } from './labels';

const INVOICE_STATUS_KEYS: Record<string, string> = {
  draft: 'invoices.statusDraft',
  issued: 'invoices.statusIssued',
  partially_paid: 'invoices.statusPartiallyPaid',
  paid: 'invoices.statusPaid',
  overdue: 'invoices.statusOverdue',
  void: 'invoices.statusVoid',
};

function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * PaymentDetailView — one payment receipt (ACC-9): the header (method,
 * amount, reference, who recorded it and when) and the allocation breakdown —
 * every invoice this receipt was applied to, with a direct link back to each
 * invoice. Receipts are append-only; there is nothing to edit or delete here.
 */
export function PaymentDetailView({ id }: { id: string }) {
  const t = useTranslations('modules.accounting');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string, currency = baseCurrency) =>
    formatMinorAmount(amountMinor, currency, { locale, exponent });
  const memberName = useMemberName();

  const { data, isPending, isError } = useAccountingPayment(id);
  // View Journal Entry (ACC-9): the receipt's GL entry modal opens in place.
  const [journalOpen, setJournalOpen] = useState(false);

  if (isPending && !data)
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (isError || !data) return <p className="py-10 text-center text-sm text-destructive">{t('errors.notFound')}</p>;

  const { payment, allocations } = data;
  const allocatedTotal = allocations.reduce((sum, allocation) => sum + BigInt(allocation.amountMinor), 0n).toString();
  const fullyAllocated = allocatedTotal === payment.amountMinor;

  return (
    <ModuleGate moduleKey="accounting">
      <div className="space-y-5 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${locale}/m/accounting/payments`}>
                <ArrowLeft className="rtl:rotate-180" />
                {t('payments.detail.back')}
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">{t('payments.detail.title')}</h1>
            {/* ACC-9: the structured receipt reference (REC-000004) replaces the raw id. */}
            <span className="font-mono text-sm font-semibold">
              {t('payments.detail.receiptNumber', { receipt: payment.receiptNumber })}
            </span>
            <Badge variant="outline">{t(`payments.methods.${payment.method}`)}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {data.journalEntry && (
              <Button variant="outline" size="sm" onClick={() => setJournalOpen(true)}>
                <BookOpen className="size-4" aria-hidden="true" />
                <span className="ms-1">
                  {t('payments.detail.viewJournalEntry', {
                    entry: `JE-${String(data.journalEntry.entryNumber).padStart(4, '0')}`,
                  })}
                </span>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden="true" />
              <span className="ms-1">{t('payments.detail.printReceipt')}</span>
            </Button>
          </div>
        </div>

        {/* Receipt header — amount + reference + actor metadata. */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs font-medium text-muted-foreground">{t('payments.detail.amount')}</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                {formatMinor(payment.amountMinor, payment.currency)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{payment.currency}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs font-medium text-muted-foreground">{t('payments.detail.receivedAt')}</p>
              <p className="mt-1 text-sm font-medium tabular-nums">{formatDateTime(payment.receivedAt, locale)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {payment.reference ? (
                  <>
                    {t('payments.detail.reference')}: <span dir="auto">{payment.reference}</span>
                  </>
                ) : (
                  t('payments.detail.noReference')
                )}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs font-medium text-muted-foreground">{t('payments.detail.recordedBy')}</p>
              <p className="mt-1 text-sm font-medium" dir="auto">
                {memberName(payment.createdBy) ?? t('payments.detail.systemActor')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(payment.createdAt, locale)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Allocation breakdown — every invoice this receipt was applied to. */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">{t('payments.detail.allocations')}</CardTitle>
              <Badge variant={fullyAllocated ? 'outline' : 'secondary'}>
                {fullyAllocated ? t('payments.detail.fullyAllocated') : t('payments.detail.partiallyAllocated')}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('payments.detail.tableInvoice')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('payments.detail.tableCustomer')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('payments.detail.tableDate')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('payments.detail.tableStatus')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('payments.detail.tableAllocated')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {allocations.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        {t('payments.detail.noAllocations')}
                      </td>
                    </tr>
                  ) : (
                    allocations.map((allocation) => (
                      <tr key={allocation.id} className="transition-colors hover:bg-accent/30">
                        <td className="px-4 py-3 font-mono text-xs">
                          <Link
                            href={`/${locale}/m/accounting/invoices/${allocation.invoiceId}`}
                            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                          >
                            <FileText className="size-3" aria-hidden="true" />
                            {allocation.invoiceNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-medium" dir="auto">
                          {allocation.customerNameSnapshot}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-muted-foreground">
                          {allocation.invoiceDate}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline">
                            {t(INVOICE_STATUS_KEYS[allocation.invoiceStatus] ?? 'invoices.statusDraft')}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                          {formatMinor(allocation.amountMinor, allocation.currency)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {allocations.length > 0 && (
                  <tfoot>
                    <tr className="border-t bg-muted/20">
                      <td colSpan={4} className="px-4 py-3 text-end text-xs font-medium text-muted-foreground">
                        {t('payments.detail.allocatedTotal')}
                      </td>
                      <td className="px-4 py-3 text-end font-mono text-xs font-semibold tabular-nums">
                        {formatMinor(allocatedTotal, payment.currency)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Journal entry modal — opened in place (ACC-9). */}
      {journalOpen && data.journalEntry && (
        <JournalEntryDetailModal entryId={data.journalEntry.id} onClose={() => setJournalOpen(false)} />
      )}
    </ModuleGate>
  );
}
