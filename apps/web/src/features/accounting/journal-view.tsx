'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { NotebookPen, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';
import { Can } from '@/lib/permissions';

import { accountingErrorKey } from './errors';
import { useAccountingCoa, useAccountingJournal, useAccountingMutations, useOrgBaseCurrency } from './hooks';
import { JournalEntryDetailModal } from './journal-entry-detail-modal';
import { accountDisplayName, formatMinorAmount } from './labels';
import { AccountingPageHeader } from './page-header';

const lineSchema = z
  .object({
    accountId: z.string().min(1),
    // ACC-4: exactly one of debit/credit — an empty side is valid here and the
    // refine below enforces "exactly one non-empty" (a `+` regex would reject
    // the empty side and block the whole form from submitting).
    debit: z.string().regex(/^\d*$/, 'must be a non-negative integer (minor units)'),
    credit: z.string().regex(/^\d*$/, 'must be a non-negative integer (minor units)'),
    memo: z.string().max(500).optional(),
  })
  // ACC-4: exactly one of debit/credit on each line.
  .refine((line) => (line.debit !== '' && line.debit !== '0') !== (line.credit !== '' && line.credit !== '0'), {
    message: 'set exactly one of debit or credit',
  });

const journalFormSchema = z
  .object({
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use the YYYY-MM-DD format'),
    description: z.string().max(500).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    // ACC-1: a single line can never balance — at least two lines are required
    // for a valid double-entry posting.
    lines: z.array(lineSchema).min(2),
  })
  // ACC-1: debits must equal credits — validated client-side so a user never
  // submits an unbalanced entry that the backend (correctly) rejects.
  .refine(
    (entry) =>
      entry.lines.reduce((sum, line) => sum + (line.debit !== '' ? Number(line.debit) : 0), 0) ===
      entry.lines.reduce((sum, line) => sum + (line.credit !== '' ? Number(line.credit) : 0), 0),
    { message: 'debits must equal credits (ACC-1)', path: ['lines'] },
  );

type JournalFormValues = z.infer<typeof journalFormSchema>;

/** Sum one side of the live lines (exact, minor units). */
function sideTotal(lines: Array<{ debit: string; credit: string }>, side: 'debit' | 'credit'): bigint {
  return lines.reduce((sum, line) => sum + (line[side] !== '' && line[side] !== '0' ? BigInt(line[side]) : 0n), 0n);
}

/**
 * JournalView — post manual journal entries (ACC-1/3/4) and list recent
 * entries with the ACC-2 reversal action. The entry form enforces, live:
 *   - exactly one of Debit/Credit per line (typing one clears the other);
 *   - Total Debit === Total Credit (ACC-1) with the totals shown at the bottom
 *     of the lines, highlighted in red while unbalanced;
 *   - at least two lines — the Post Entry button is disabled until the entry
 *     is balanced AND has two or more lines.
 */
export function JournalView({ initialEntryId = null }: { initialEntryId?: string | null }) {
  const t = useTranslations('modules.accounting');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: coa } = useAccountingCoa();
  // The manual entry form is collapsed by default so the transaction history
  // table is the primary focus on page load; '+ New Entry' expands it.
  const [formOpen, setFormOpen] = useState(false);
  // Free-text search + date-range filters (server-side, committed on Apply).
  const [q, setQ] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [range, setRange] = useState<{ q?: string; fromDate?: string; toDate?: string }>({});
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const { data: entries, isPending } = useAccountingJournal({
    ...(range.q ? { q: range.q } : {}),
    ...(range.fromDate ? { fromDate: range.fromDate } : {}),
    ...(range.toDate ? { toDate: range.toDate } : {}),
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = entries ? Math.max(1, Math.ceil(entries.total / entries.pageSize)) : 1;
  const { postJournalEntry, reverseJournalEntry } = useAccountingMutations();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // ACC-2 detail: clicking an entry row opens its line-item detail modal. A
  // deep link `?entry=<uuid>` (e.g. from the invoice detail's View Journal
  // Entry) opens the modal on load — the entry id is read server-side in the
  // page and passed in, so it survives SSR/hydration.
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(initialEntryId);

  const form = useForm<JournalFormValues>({
    resolver: zodResolver(journalFormSchema),
    defaultValues: {
      entryDate: new Date().toISOString().slice(0, 10),
      currency: baseCurrency,
      lines: [
        { accountId: '', debit: '', credit: '', memo: '' },
        { accountId: '', debit: '', credit: '', memo: '' },
      ],
    },
    mode: 'onChange',
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });

  // Live totals (ACC-1) — the Post button stays disabled until balanced + ≥2
  // lines, and the totals footer turns red while the entry is unbalanced.
  const liveLines = form.watch('lines');
  const totalDebit = sideTotal(liveLines, 'debit');
  const totalCredit = sideTotal(liveLines, 'credit');
  const unbalanced = totalDebit !== totalCredit;
  const difference = totalDebit > totalCredit ? totalDebit - totalCredit : totalCredit - totalDebit;
  // Strict rule (ACC-1): at least two lines, a balanced entry, and every line
  // carrying an amount on one side (an empty line is not postable).
  const allLinesHaveAmount = liveLines.every((line) => line.debit !== '' || line.credit !== '');
  const canPost = liveLines.length >= 2 && !unbalanced && allLinesHaveAmount;

  const accountOptions = (coa?.items ?? []).map((account) => ({
    value: account.id,
    label: `${account.code} · ${accountDisplayName(account, locale, t)}`,
  }));

  const handlePost = async (values: JournalFormValues) => {
    setError(null);
    setSuccess(null);
    try {
      const result = await postJournalEntry.mutateAsync({
        entryDate: values.entryDate,
        ...(values.description ? { description: values.description } : {}),
        currency: values.currency,
        lines: values.lines.map((line) => ({
          accountId: line.accountId,
          ...(line.debit && line.debit !== '0'
            ? { debit: { amountMinor: line.debit, currency: values.currency } }
            : { credit: { amountMinor: line.credit, currency: values.currency } }),
          ...(line.memo ? { memo: line.memo } : {}),
        })),
      });
      setSuccess(t('journal.postedMessage', { entryNumber: String(result.entryNumber) }));
      form.reset({
        entryDate: new Date().toISOString().slice(0, 10),
        currency: values.currency,
        lines: [
          { accountId: '', debit: '', credit: '', memo: '' },
          { accountId: '', debit: '', credit: '', memo: '' },
        ],
      });
    } catch (err) {
      setError(err instanceof ApiError ? t(accountingErrorKey(err.code)) : t('errors.unknown'));
    }
  };

  const handleReverse = async (entryId: string) => {
    setError(null);
    setSuccess(null);
    try {
      await reverseJournalEntry.mutateAsync(entryId);
      setSuccess(t('journal.reversedMessage'));
    } catch (err) {
      setError(err instanceof ApiError ? t(accountingErrorKey(err.code)) : t('errors.unknown'));
    }
  };

  return (
    <ModuleGate moduleKey="accounting">
      <div className="space-y-6 animate-fade-in">
        <AccountingPageHeader
          icon={NotebookPen}
          title={t('journal.title')}
          subtitle={t('journal.subtitle')}
          actions={
            <Can permission="accounting:journal:post">
              <Button
                variant={formOpen ? 'outline' : 'default'}
                onClick={() => setFormOpen((open) => !open)}
                aria-expanded={formOpen}
              >
                {formOpen ? t('journal.hideForm') : t('journal.newEntry')}
              </Button>
            </Can>
          }
        />

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {success && (
          <p
            role="status"
            className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
          >
            {success}
          </p>
        )}

        <Can permission="accounting:journal:post">
          {formOpen && (
            <Card className="border-primary/20">
              <CardContent className="pt-6">
                <form className="space-y-4" onSubmit={(event) => void form.handleSubmit(handlePost)(event)}>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="journal-date">{t('journal.fields.entryDate')}</Label>
                      <Input id="journal-date" type="date" {...form.register('entryDate')} />
                      {form.formState.errors.entryDate && (
                        <p className="text-xs text-destructive">{form.formState.errors.entryDate.message}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="journal-currency">{t('journal.fields.currency')}</Label>
                      <Input id="journal-currency" className="font-mono uppercase" {...form.register('currency')} />
                      {form.formState.errors.currency && (
                        <p className="text-xs text-destructive">{form.formState.errors.currency.message}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="journal-description">{t('journal.fields.description')}</Label>
                      <Input id="journal-description" dir="auto" {...form.register('description')} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t('journal.fields.lines')}</p>
                    <div className="divide-y divide-border rounded-md border">
                      {fields.map((field, index) => {
                        const lineErrors = form.formState.errors.lines?.[index];
                        return (
                          <div key={field.id} className="grid gap-2 px-3 py-2 md:grid-cols-[1fr_8rem_8rem_1fr_auto]">
                            <div className="min-w-0 space-y-1">
                              <Combobox
                                id={`journal-line-${index}-account`}
                                value={form.watch(`lines.${index}.accountId`)}
                                onValueChange={(value) => form.setValue(`lines.${index}.accountId`, value)}
                                options={accountOptions}
                                placeholder={t('journal.fields.accountPlaceholder')}
                                searchPlaceholder={t('select.search')}
                                emptyText={t('select.empty')}
                              />
                              {lineErrors?.accountId && (
                                <p className="text-xs text-destructive">{t('journal.fields.accountRequired')}</p>
                              )}
                            </div>
                            <div className="space-y-1">
                              <Input
                                className="font-mono"
                                inputMode="numeric"
                                placeholder={t('journal.fields.debit')}
                                aria-label={t('journal.fields.debit')}
                                // ACC-4 single-side rule: typing a debit clears
                                // the line's credit, and vice versa.
                                value={form.watch(`lines.${index}.debit`)}
                                onChange={(event) => {
                                  const value = event.target.value.replace(/\D/g, '');
                                  form.setValue(`lines.${index}.debit`, value);
                                  if (value !== '') form.setValue(`lines.${index}.credit`, '');
                                }}
                              />
                              {lineErrors?.debit && (
                                <p className="text-xs text-destructive">{lineErrors.debit.message}</p>
                              )}
                            </div>
                            <div className="space-y-1">
                              <Input
                                className="font-mono"
                                inputMode="numeric"
                                placeholder={t('journal.fields.credit')}
                                aria-label={t('journal.fields.credit')}
                                value={form.watch(`lines.${index}.credit`)}
                                onChange={(event) => {
                                  const value = event.target.value.replace(/\D/g, '');
                                  form.setValue(`lines.${index}.credit`, value);
                                  if (value !== '') form.setValue(`lines.${index}.debit`, '');
                                }}
                              />
                              {lineErrors?.credit && (
                                <p className="text-xs text-destructive">{lineErrors.credit.message}</p>
                              )}
                              {lineErrors?.root && (
                                <p className="text-xs text-destructive">{lineErrors.root.message}</p>
                              )}
                            </div>
                            <Input
                              dir="auto"
                              placeholder={t('journal.fields.memo')}
                              aria-label={t('journal.fields.memo')}
                              {...form.register(`lines.${index}.memo`)}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="justify-self-end"
                              onClick={() => remove(index)}
                              disabled={fields.length <= 2}
                              aria-label={t('journal.removeLine')}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                    {form.formState.errors.lines?.root && (
                      <p className="text-xs text-destructive">{form.formState.errors.lines.root.message}</p>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => append({ accountId: '', debit: '', credit: '', memo: '' })}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      <span className="ms-1">{t('journal.addLine')}</span>
                    </Button>
                  </div>

                  {/* ACC-1 live balance footer — red while unbalanced. */}
                  <div
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
                      unbalanced ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'border-border'
                    }`}
                    role="status"
                  >
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                      <span>
                        {t('journal.totalDebit')}{' '}
                        <span className="font-mono tabular-nums">
                          {formatMinorAmount(totalDebit.toString(), baseCurrency, { locale })}
                        </span>
                      </span>
                      <span>
                        {t('journal.totalCredit')}{' '}
                        <span className="font-mono tabular-nums">
                          {formatMinorAmount(totalCredit.toString(), baseCurrency, { locale })}
                        </span>
                      </span>
                    </div>
                    <span className={unbalanced ? 'font-medium' : 'text-muted-foreground'}>
                      {unbalanced
                        ? t('journal.unbalancedHint', {
                            difference: formatMinorAmount(difference.toString(), baseCurrency, { locale }),
                          })
                        : t('journal.balancedHint')}
                    </span>
                  </div>

                  <Button
                    type="submit"
                    loading={postJournalEntry.isPending}
                    // Strict rule: Post is disabled unless the entry is balanced
                    // (ACC-1) AND has at least two lines.
                    disabled={!canPost}
                  >
                    {t('journal.submit')}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </Can>

        {/* Search + date-range filters above the ledger (server-side). */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="journal-search">{t('journal.search')}</Label>
            <Input
              id="journal-search"
              type="search"
              dir="auto"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={t('journal.searchPlaceholder')}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="journal-from">{t('journal.fromDate')}</Label>
            <Input
              id="journal-from"
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="journal-to">{t('journal.toDate')}</Label>
            <Input id="journal-to" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </div>
          <Button
            size="sm"
            disabled={q === '' && fromDate === '' && toDate === ''}
            onClick={() => {
              setPage(1);
              setRange({
                ...(q.trim() !== '' ? { q: q.trim() } : {}),
                ...(fromDate ? { fromDate } : {}),
                ...(toDate ? { toDate } : {}),
              });
            }}
          >
            {t('journal.apply')}
          </Button>
          {(range.q !== undefined || range.fromDate !== undefined || range.toDate !== undefined) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ('');
                setFromDate('');
                setToDate('');
                setRange({});
                setPage(1);
              }}
            >
              {t('journal.clear')}
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('journal.tableNumber')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('journal.tableDate')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('journal.tableDescription')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('journal.tableStatus')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('journal.tableActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isPending && !entries ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        {t('common.loading')}
                      </td>
                    </tr>
                  ) : (entries?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        {t('journal.empty')}
                      </td>
                    </tr>
                  ) : (
                    entries?.items.map((entry) => (
                      <tr
                        key={entry.id}
                        className="cursor-pointer transition-colors hover:bg-accent/30"
                        onClick={() => setSelectedEntryId(entry.id)}
                      >
                        <td className="px-4 py-3 font-mono text-xs">
                          <button
                            type="button"
                            className="text-primary underline-offset-4 hover:underline"
                            aria-label={t('journal.openDetail')}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedEntryId(entry.id);
                            }}
                          >
                            JE-{String(entry.entryNumber).padStart(4, '0')}
                          </button>
                        </td>
                        <td className="px-4 py-3">{entry.entryDate}</td>
                        <td className="px-4 py-3 text-muted-foreground" dir="auto">
                          {entry.description || '—'}
                        </td>
                        <td className="px-4 py-3 text-end">
                          {entry.status === 'reversed' ? (
                            <Badge variant="secondary">{t('journal.statusReversed')}</Badge>
                          ) : (
                            <Badge variant="outline">{t('journal.statusPosted')}</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-end" onClick={(event) => event.stopPropagation()}>
                          <Can permission="accounting:journal:post">
                            {entry.status === 'posted' && (
                              <Button
                                variant="outline"
                                size="sm"
                                loading={reverseJournalEntry.isPending}
                                onClick={() => void handleReverse(entry.id)}
                              >
                                {t('journal.reverse')}
                              </Button>
                            )}
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
        {/* Pagination — prev/next with the shown/total count (filters reset to page 1). */}
        {entries && entries.total > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-xs text-muted-foreground">
              {t('journal.shownCount', {
                shown: String(Math.min(entries.total, (page - 1) * PAGE_SIZE + (entries.items.length || PAGE_SIZE))),
                total: String(entries.total),
              })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                {t('journal.previous')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t('journal.pageOf', { page: String(entries.page), total: String(totalPages) })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                {t('journal.next')}
              </Button>
            </div>
          </div>
        )}

        {selectedEntryId && (
          <JournalEntryDetailModal entryId={selectedEntryId} onClose={() => setSelectedEntryId(null)} />
        )}
      </div>
    </ModuleGate>
  );
}
