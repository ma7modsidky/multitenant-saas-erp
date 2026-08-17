'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useMemberName } from '@/lib/hooks/use-member-name';

import { useAccountingJournalEntry, useCurrencies, useOrgBaseCurrency } from './hooks';
import { accountDisplayName, formatMinorAmount } from './labels';

/** Localized source-type labels (the entry's source reference, ACC-15). */
function sourceLabel(t: (key: string) => string, sourceType: string): string {
  switch (sourceType) {
    case 'invoice_issuance':
      return t('journal.sourceInvoiceIssuance');
    case 'credit_note':
      return t('journal.sourceCreditNote');
    case 'stock_movement':
      return t('journal.sourceStockMovement');
    default:
      return t('journal.sourceManual');
  }
}

function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * JournalEntryDetailModal — the detail view for one journal entry: every line
 * item resolved to its account (code + name, ACC-4), the Dr/Cr amounts and
 * memos, the actor metadata (who created / posted it), and a direct link to
 * the source document when one exists (e.g. the invoice that produced the AR
 * entry, ACC-6).
 */
export function JournalEntryDetailModal({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const t = useTranslations('modules.accounting');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, baseCurrency, { locale, exponent });
  const memberName = useMemberName();

  // ACC-2 reversal trail: viewing a reversed entry shows a link to its
  // reversing entry — clicking it swaps the modal's content to that entry.
  const [viewEntryId, setViewEntryId] = useState(entryId);
  const { data, isPending, isError } = useAccountingJournalEntry(viewEntryId);

  /** Format a journal reference — 'JE-0005'. */
  const entryReference = (entryNumber: number) => `JE-${String(entryNumber).padStart(4, '0')}`;

  /** Actor display: a real member name, 'System (Auto-generated)' for the
   *  NULL actor that system-driven paths record (ACC-13/ACC-15), or a dash
   *  when the actor is unknown. */
  const actorName = (actorId: string | null): string =>
    actorId === null ? t('journal.systemActor') : (memberName(actorId) ?? '—');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="journal-detail-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50 cursor-default"
        onClick={onClose}
        aria-hidden="true"
        tabIndex={-1}
      />
      <Card className="relative w-full max-w-2xl animate-fade-in">
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <div className="space-y-1">
            <CardTitle id="journal-detail-title" className="text-base">
              {isPending && !data
                ? t('common.loading')
                : data
                  ? t('journal.detailTitle', { entry: entryReference(data.entry.entryNumber) })
                  : ''}
            </CardTitle>
            {data && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  JE-{String(data.entry.entryNumber).padStart(4, '0')}
                </span>
                <Badge variant={data.entry.status === 'reversed' ? 'secondary' : 'outline'}>
                  {data.entry.status === 'reversed' ? t('journal.statusReversed') : t('journal.statusPosted')}
                </Badge>
                <span className="text-xs text-muted-foreground">{data.entry.entryDate}</span>
                {data.entry.description && (
                  <span className="text-sm text-muted-foreground" dir="auto">
                    {data.entry.description}
                  </span>
                )}
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-me-1 -mt-1 size-7"
            onClick={onClose}
            aria-label={t('journal.closeDetail')}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </CardHeader>

        <CardContent className="space-y-4 pt-0">
          {isPending && !data ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : isError || !data ? (
            <p className="py-6 text-center text-sm text-destructive">{t('errors.notFound')}</p>
          ) : (
            <>
              {/* Line items resolved to accounts (ACC-4). */}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 text-start font-medium">{t('journal.detailAccount')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('journal.fields.debit')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('journal.fields.credit')}</th>
                      <th className="px-3 py-2 text-start font-medium">{t('journal.detailMemo')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.entry.lines.map((line) => (
                      <tr key={line.id} className="transition-colors hover:bg-accent/30">
                        <td className="px-3 py-2">
                          <span className="font-mono text-xs text-muted-foreground">{line.accountCode ?? '—'}</span>{' '}
                          <span className="font-medium" dir="auto">
                            {line.accountNameI18n
                              ? accountDisplayName({ nameI18n: line.accountNameI18n }, locale, t)
                              : '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-end font-mono text-xs tabular-nums">
                          {line.debitAmountMinor !== '0' ? formatMinor(line.debitAmountMinor) : '—'}
                        </td>
                        <td className="px-3 py-2 text-end font-mono text-xs tabular-nums">
                          {line.creditAmountMinor !== '0' ? formatMinor(line.creditAmountMinor) : '—'}
                        </td>
                        <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-muted-foreground" dir="auto">
                          {line.memo || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t text-xs">
                      <td className="px-3 py-2 text-end font-medium text-muted-foreground">
                        {t('journal.totalDebit')}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums">
                        {formatMinor(
                          data.entry.lines
                            .reduce((sum, line) => sum + BigInt(line.debitAmountMinor || '0'), 0n)
                            .toString(),
                        )}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums">
                        {formatMinor(
                          data.entry.lines
                            .reduce((sum, line) => sum + BigInt(line.creditAmountMinor || '0'), 0n)
                            .toString(),
                        )}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Actor metadata + source document (ACC-6/ACC-15). */}
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="space-y-1">
                  <dt className="text-xs font-medium text-muted-foreground">{t('journal.detailCreatedBy')}</dt>
                  <dd dir="auto">{actorName(data.entry.createdBy)}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs font-medium text-muted-foreground">{t('journal.detailCreatedAt')}</dt>
                  <dd>{formatDateTime(data.entry.createdAt, locale)}</dd>
                </div>
                {data.entry.postedAt && (
                  <>
                    <div className="space-y-1">
                      <dt className="text-xs font-medium text-muted-foreground">{t('journal.detailPostedBy')}</dt>
                      <dd dir="auto">{actorName(data.entry.postedBy)}</dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-xs font-medium text-muted-foreground">{t('journal.detailPostedAt')}</dt>
                      <dd>{formatDateTime(data.entry.postedAt, locale)}</dd>
                    </div>
                  </>
                )}
                <div className="space-y-1">
                  <dt className="text-xs font-medium text-muted-foreground">{t('journal.detailSource')}</dt>
                  <dd>
                    {data.entry.sourceType === 'invoice_issuance' && data.entry.sourceId ? (
                      <Link
                        href={`/${locale}/m/accounting/invoices/${data.entry.sourceId}`}
                        className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                      >
                        {t('journal.viewInvoice')}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{sourceLabel(t, data.entry.sourceType)}</span>
                    )}
                  </dd>
                </div>
                {data.entry.status === 'reversed' && data.entry.reversedBy && (
                  <div className="space-y-1">
                    <dt className="text-xs font-medium text-muted-foreground">{t('journal.detailReversedBy')}</dt>
                    <dd>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-primary underline-offset-4 hover:underline"
                        onClick={() => {
                          const reversal = data.entry.reversedBy;
                          if (reversal) setViewEntryId(reversal.id);
                        }}
                        aria-label={t('journal.openReversal', {
                          entry: entryReference(data.entry.reversedBy.entryNumber),
                        })}
                      >
                        {t('journal.reversedBy', {
                          entry: entryReference(data.entry.reversedBy.entryNumber),
                        })}
                      </Button>
                    </dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
