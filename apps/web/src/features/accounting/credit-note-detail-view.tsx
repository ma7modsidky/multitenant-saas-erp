'use client';

import { ArrowLeft, BookOpen, Download, FileText, Printer } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ModuleGate } from '@/lib/entitlements';

import { useAccountingCreditNote, useCurrencies, useOrgBaseCurrency } from './hooks';
import { JournalEntryDetailModal } from './journal-entry-detail-modal';
import { formatMinorAmount } from './labels';

function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * CreditNoteDetailView — one credit note (ACC-10): the printable reversal
 * document with the referenced invoice, the reversal reason/memo, the reversed
 * lines resolved to item names, and the reversal journal entry (Dr Revenue,
 * Cr AR). Actions: Print / Export PDF (both use the print layout — the browser
 * dialog's Save-as-PDF is the PDF destination) and View Journal Entry, which
 * opens the GL entry modal in place. Credit notes are immutable once issued.
 */
export function CreditNoteDetailView({ id }: { id: string }) {
  const t = useTranslations('modules.accounting');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string, currency = baseCurrency) =>
    formatMinorAmount(amountMinor, currency, { locale, exponent });

  const { data, isPending, isError } = useAccountingCreditNote(id);
  const [journalOpen, setJournalOpen] = useState(false);

  if (isPending && !data)
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (isError || !data) return <p className="py-10 text-center text-sm text-destructive">{t('errors.notFound')}</p>;

  const note = data.creditNote;
  const linesTotal = note.lines.reduce((sum, line) => sum + BigInt(line.lineTotalAmountMinor || '0'), 0n).toString();

  const DetailField = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm" dir="auto">
        {value}
      </dd>
    </div>
  );

  return (
    <ModuleGate moduleKey="accounting">
      <div className="space-y-5 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="print:hidden">
              <Link href={`/${locale}/m/accounting/credit-notes`}>
                <ArrowLeft className="rtl:rotate-180" />
                {t('detail.back')}
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">{note.creditNoteNumber}</h1>
            <Badge variant="secondary">{t('creditNotes.statusCredited')}</Badge>
            {data.journalEntry && (
              <Button variant="outline" size="sm" className="print:hidden" onClick={() => setJournalOpen(true)}>
                <BookOpen className="size-4" aria-hidden="true" />
                <span className="ms-1">
                  {t('creditNotes.viewJournalEntry', {
                    entry: `JE-${String(data.journalEntry.entryNumber).padStart(4, '0')}`,
                  })}
                </span>
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden="true" />
              <span className="ms-1">{t('creditNotes.print')}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Download className="size-4" aria-hidden="true" />
              <span className="ms-1">{t('creditNotes.exportPdf')}</span>
            </Button>
          </div>
        </div>

        {/* Document header — who + what was reversed (printable). */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('creditNotes.detail.document')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label={t('creditNotes.detail.customer')} value={note.customerNameSnapshot} />
              <DetailField
                label={t('creditNotes.detail.originalInvoice')}
                value={
                  <Link
                    href={`/${locale}/m/accounting/invoices/${note.invoiceId}`}
                    className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  >
                    <FileText className="size-3" aria-hidden="true" />
                    {note.invoiceNumber}
                  </Link>
                }
              />
              <DetailField label={t('creditNotes.detail.issuedAt')} value={formatDateTime(note.issuedAt, locale)} />
              <DetailField label={t('creditNotes.detail.currency')} value={note.currency} />
              <DetailField label={t('creditNotes.detail.reason')} value={note.reasonCode || '—'} />
            </dl>
          </CardContent>
        </Card>

        {/* Reversed lines (ACC-10). */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('creditNotes.detail.linesTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('detail.tableItem')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('detail.tableQty')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('detail.tableUnitPrice')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('detail.tableTax')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('detail.tableLineTotal')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {note.lines.map((line) => (
                    <tr key={line.id} className="transition-colors hover:bg-accent/30">
                      <td className="px-4 py-3 font-medium" dir="auto">
                        {line.itemNameSnapshot}
                      </td>
                      <td className="px-4 py-3 text-end font-mono text-xs">{line.quantity}</td>
                      <td className="px-4 py-3 text-end font-mono text-xs">
                        {formatMinor(line.unitPriceAmountMinor, note.currency)}
                      </td>
                      <td className="px-4 py-3 text-end font-mono text-xs">
                        {formatMinor(line.taxAmountMinor, note.currency)}
                      </td>
                      <td className="px-4 py-3 text-end font-mono text-xs font-semibold">
                        {formatMinor(line.lineTotalAmountMinor, note.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t text-sm">
                    <td colSpan={4} className="px-4 py-2 text-end font-medium text-muted-foreground">
                      {t('creditNotes.tableCredited')}
                    </td>
                    <td className="px-4 py-2 text-end font-mono text-xs font-semibold">
                      {formatMinor(linesTotal, note.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Journal entry modal — opened in place (ACC-10). */}
      {journalOpen && data.journalEntry && (
        <JournalEntryDetailModal entryId={data.journalEntry.id} onClose={() => setJournalOpen(false)} />
      )}
    </ModuleGate>
  );
}
