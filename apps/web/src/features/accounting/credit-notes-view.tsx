'use client';

import { Eye, FileText } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ModuleGate } from '@/lib/entitlements';

import { useAccountingCreditNotes, useCurrencies, useOrgBaseCurrency } from './hooks';
import { formatMinorAmount } from './labels';
import { AccountingPageHeader } from './page-header';

const PAGE_SIZE = 20;

/**
 * CreditNotesView — the credit-note reversal trail (ACC-10): every issued note
 * with the invoice it reverses and the customer. Free-text search + server-side
 * pagination; each row opens the printable credit-note detail (with the linked
 * invoice + reversal journal entry). Credit notes are immutable once issued —
 * there is nothing to edit or delete here.
 */
export function CreditNotesView() {
  const t = useTranslations('modules.accounting');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string, currency = baseCurrency) =>
    formatMinorAmount(amountMinor, currency, { locale, exponent });

  const [q, setQ] = useState('');
  const [range, setRange] = useState<{ q?: string }>({});
  const [page, setPage] = useState(1);

  const { data, isPending } = useAccountingCreditNotes({
    ...(range.q ? { q: range.q } : {}),
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <ModuleGate moduleKey="accounting">
      <div className="space-y-6 animate-fade-in">
        <AccountingPageHeader icon={FileText} title={t('creditNotes.title')} subtitle={t('creditNotes.subtitle')} />

        {/* Search — note number, invoice number, or customer (server-side). */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="credit-notes-search">{t('creditNotes.search')}</Label>
            <Input
              id="credit-notes-search"
              type="search"
              dir="auto"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={t('creditNotes.searchPlaceholder')}
            />
          </div>
          <Button
            size="sm"
            disabled={q.trim() === ''}
            onClick={() => {
              setPage(1);
              setRange(q.trim() !== '' ? { q: q.trim() } : {});
            }}
          >
            {t('creditNotes.apply')}
          </Button>
          {range.q !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ('');
                setRange({});
                setPage(1);
              }}
            >
              {t('creditNotes.clear')}
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('creditNotes.tableNumber')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('creditNotes.tableInvoice')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('creditNotes.tableCustomer')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('creditNotes.tableReason')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('creditNotes.tableCredited')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('creditNotes.tableStatus')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('creditNotes.tableActions')}</th>
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
                        {t('creditNotes.empty')}
                      </td>
                    </tr>
                  ) : (
                    data?.items.map((note) => (
                      <tr key={note.id} className="transition-colors hover:bg-accent/30">
                        <td className="px-4 py-3 font-mono text-xs">{note.creditNoteNumber}</td>
                        <td className="px-4 py-3 font-mono text-xs">
                          <Link
                            href={`/${locale}/m/accounting/invoices/${note.invoiceId}`}
                            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                          >
                            <FileText className="size-3" aria-hidden="true" />
                            {note.invoiceNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-medium" dir="auto">
                          {note.customerNameSnapshot}
                        </td>
                        <td className="max-w-[12rem] truncate px-4 py-3 text-muted-foreground" dir="auto">
                          {note.reasonCode}
                        </td>
                        <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                          {formatMinor(note.amountMinor, note.currency)}
                        </td>
                        <td className="px-4 py-3 text-end">
                          <Badge variant="secondary">{t('creditNotes.statusCredited')}</Badge>
                        </td>
                        <td className="px-4 py-3 text-end">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/${locale}/m/accounting/credit-notes/${note.id}`}>
                              <Eye className="size-4" aria-hidden="true" />
                              <span className="ms-1">{t('creditNotes.viewNote')}</span>
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

        {/* Pagination — prev/next with the shown/total count (search resets to page 1). */}
        {data && data.total > data.pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {t('creditNotes.shownCount', {
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
                {t('creditNotes.previous')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t('creditNotes.pageOf', { page: String(data.page), total: String(totalPages) })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t('creditNotes.next')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </ModuleGate>
  );
}
