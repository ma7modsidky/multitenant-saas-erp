'use client';

import { ArrowLeft, BookOpen, Download, Printer, Undo2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';
import { Can } from '@/lib/permissions';

import type { AccountingInvoiceLine } from '@/lib/api/resources';

import { accountingErrorKey } from './errors';
import { useAccountingInvoice, useAccountingMutations, useCurrencies, useOrgBaseCurrency } from './hooks';
import { JournalEntryDetailModal } from './journal-entry-detail-modal';
import { formatMinorAmount } from './labels';

const PAYMENT_METHODS: readonly ['cash', 'bank_transfer', 'card', 'cheque', 'other'] = [
  'cash',
  'bank_transfer',
  'card',
  'cheque',
  'other',
];
const isPaymentMethod = (value: string): value is (typeof PAYMENT_METHODS)[number] =>
  PAYMENT_METHODS.some((method) => method === value);

const STATUS_KEYS: Record<string, string> = {
  draft: 'invoices.statusDraft',
  issued: 'invoices.statusIssued',
  partially_paid: 'invoices.statusPartiallyPaid',
  paid: 'invoices.statusPaid',
  overdue: 'invoices.statusOverdue',
  void: 'invoices.statusVoid',
};

/** A line being credited — quantity and unit price editable, checked to include. */
interface CreditLineState {
  invoiceLineId: string;
  include: boolean;
  quantity: string;
  unitPriceMinor: string;
}

/**
 * InvoiceDetailView — the AR document view: customer + document info, the
 * itemized lines (ACC-6/11), the payment history timeline (ACC-9), and the
 * credit-note trail (ACC-10). Actions: print / CSV export, record a payment
 * (issued/overdue/partially paid), and issue a credit note.
 */
export function InvoiceDetailView({ id }: { id: string }) {
  const t = useTranslations('modules.accounting');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string, currency = baseCurrency) =>
    formatMinorAmount(amountMinor, currency, { locale, exponent });

  const { data, isPending, isError } = useAccountingInvoice(id);
  const { applyPayment, issueCreditNote } = useAccountingMutations();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // View Journal Entry (ACC-6): the GL entry modal opens in place — no
  // navigation away from the invoice document.
  const [journalEntryOpen, setJournalEntryOpen] = useState(false);

  // ─── Record payment modal state (ACC-9) ──────────────────────────────────
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<(typeof PAYMENT_METHODS)[number]>('cash');
  const [payReference, setPayReference] = useState('');

  // ─── Issue credit note modal state (ACC-10) ──────────────────────────────
  const [creditOpen, setCreditOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [creditLines, setCreditLines] = useState<CreditLineState[]>([]);

  if (isPending && !data)
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (isError || !data) return <p className="py-10 text-center text-sm text-destructive">{t('errors.notFound')}</p>;

  const invoice = data.invoice;
  const statusLabel = STATUS_KEYS[invoice.status] ?? 'invoices.statusDraft';
  const canPay = invoice.status === 'issued' || invoice.status === 'partially_paid' || invoice.status === 'overdue';
  const balanceDue = (
    BigInt(invoice.totalAmountMinor) -
    BigInt(invoice.paidAmountMinor) -
    BigInt(invoice.creditedAmountMinor)
  ).toString();
  // ACC-9: Record Payment is offered only while money is actually owed.
  const canRecordPayment = canPay && BigInt(balanceDue) > 0n;

  const openPay = () => {
    setPayAmount(balanceDue);
    setPayMethod('cash');
    setPayReference('');
    setPayOpen(true);
  };

  const handleApplyPayment = async () => {
    setError(null);
    setSuccess(null);
    try {
      await applyPayment.mutateAsync({
        invoiceId: invoice.id,
        method: payMethod,
        amount: { amountMinor: payAmount || '0', currency: invoice.currency },
        ...(payReference ? { reference: payReference } : {}),
      });
      setSuccess(t('invoices.paymentAppliedMessage'));
      setPayOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? t(accountingErrorKey(err.code)) : t('errors.unknown'));
    }
  };

  const openCreditNote = () => {
    setReasonCode('');
    setCreditLines(
      invoice.lines.map((line) => ({
        invoiceLineId: line.id,
        include: true,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceAmountMinor,
      })),
    );
    setCreditOpen(true);
  };

  const handleIssueCreditNote = async () => {
    if (!reasonCode.trim()) return;
    const selected = creditLines.filter((line) => line.include);
    if (selected.length === 0) return;
    setError(null);
    setSuccess(null);
    try {
      const result = await issueCreditNote.mutateAsync({
        invoiceId: invoice.id,
        reasonCode: reasonCode.trim(),
        lines: selected.map((line) => ({
          invoiceLineId: line.invoiceLineId,
          quantity: line.quantity,
          unitPrice: { amountMinor: line.unitPriceMinor, currency: invoice.currency },
        })),
      });
      setSuccess(t('creditNotes.issuedMessage', { creditNoteNumber: result.creditNoteNumber }));
      setCreditOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? t(accountingErrorKey(err.code)) : t('errors.unknown'));
    }
  };

  /** CSV export of the document + payment history (client-side download). */
  const handleExportCsv = () => {
    const esc = (value: string | number | null | undefined) => {
      const raw = String(value ?? '');
      return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
    };
    const rows: string[] = [
      [`Invoice ${invoice.invoiceNumber}`, invoice.customerNameSnapshot, `Status: ${t(statusLabel)}`].join(','),
      [
        t('detail.tableItem'),
        t('detail.tableQty'),
        t('detail.tableUnitPrice'),
        t('detail.tableTax'),
        t('detail.tableLineTotal'),
      ].join(','),
      ...invoice.lines.map((line) =>
        [
          esc(line.itemNameSnapshot),
          esc(line.quantity),
          esc(formatMinor(line.unitPriceAmountMinor)),
          esc(formatMinor(line.taxAmountMinor)),
          esc(formatMinor(line.lineTotalAmountMinor)),
        ].join(','),
      ),
      '',
      [t('invoices.tableTotal'), esc(formatMinor(invoice.totalAmountMinor))].join(','),
      [t('detail.paidAmount'), esc(formatMinor(invoice.paidAmountMinor))].join(','),
      [t('detail.balanceDue'), esc(formatMinor(balanceDue))].join(','),
    ];
    const blob = new Blob([`\uFEFF${rows.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${invoice.invoiceNumber}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

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
              <Link href={`/${locale}/m/accounting/invoices`}>
                <ArrowLeft className="rtl:rotate-180" />
                {t('detail.back')}
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">{invoice.invoiceNumber}</h1>
            <Badge variant={invoice.status === 'paid' ? 'secondary' : 'outline'}>{t(statusLabel)}</Badge>
            {invoice.sourceType === 'pos_sale' && <Badge variant="outline">{t('invoices.posSource')}</Badge>}
            {data.journalEntry && (
              <Button variant="outline" size="sm" className="print:hidden" onClick={() => setJournalEntryOpen(true)}>
                <BookOpen className="size-4" aria-hidden="true" />
                <span className="ms-1">
                  {t('invoices.viewJournalEntry', {
                    entry: `JE-${String(data.journalEntry.entryNumber).padStart(4, '0')}`,
                  })}
                </span>
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden="true" />
              <span className="ms-1">{t('invoices.print')}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCsv}>
              <Download className="size-4" aria-hidden="true" />
              <span className="ms-1">{t('invoices.export')}</span>
            </Button>
            {canRecordPayment && (
              <Can permission="accounting:payment:apply">
                <Button size="sm" onClick={openPay}>
                  <Wallet className="size-4" aria-hidden="true" />
                  <span className="ms-1">{t('invoices.pay')}</span>
                </Button>
              </Can>
            )}
            {invoice.status !== 'void' && invoice.status !== 'draft' && (
              <Can permission="accounting:credit-note:issue">
                <Button variant="outline" size="sm" onClick={openCreditNote}>
                  <Undo2 className="size-4" aria-hidden="true" />
                  <span className="ms-1">{t('invoices.issueCreditNote')}</span>
                </Button>
              </Can>
            )}
          </div>
        </div>

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

        {/* Customer + document info (ACC-6 snapshots). */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('invoices.customerInfo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label={t('invoices.fields.customerName')} value={invoice.customerNameSnapshot} />
              <DetailField label={t('invoices.fields.customerTaxId')} value={invoice.customerTaxIdSnapshot || '—'} />
              <DetailField label={t('invoices.fields.issueDate')} value={invoice.invoiceDate} />
              <DetailField label={t('invoices.fields.dueDate')} value={invoice.dueDate} />
              <DetailField label={t('invoices.fields.currency')} value={invoice.currency} />
              <DetailField
                label={t('invoices.fields.sellerTaxId')}
                value={invoice.sellerTaxId || data.orgSellerTaxId || '—'}
              />
            </dl>
          </CardContent>
        </Card>

        {/* Itemized lines (ACC-6/11). */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('invoices.linesTitle')}</CardTitle>
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
                  {invoice.lines.map((line) => (
                    <tr key={line.id} className="transition-colors hover:bg-accent/30">
                      <td className="px-4 py-3 font-medium" dir="auto">
                        {line.itemNameSnapshot}
                        {line.description && (
                          <span className="block text-xs text-muted-foreground" dir="auto">
                            {line.description}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-end font-mono text-xs">{line.quantity}</td>
                      <td className="px-4 py-3 text-end font-mono text-xs">{formatMinor(line.unitPriceAmountMinor)}</td>
                      <td className="px-4 py-3 text-end font-mono text-xs">
                        {formatMinor(line.taxAmountMinor)}
                        {line.taxRateBpSnapshot > 0 && (
                          <span className="ms-1 text-muted-foreground">({line.taxRateBpSnapshot / 100}%)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-end font-mono text-xs font-semibold">
                        {formatMinor(line.lineTotalAmountMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t text-sm">
                    <td colSpan={4} className="px-4 py-2 text-end text-muted-foreground">
                      {t('invoices.tableSubtotal')}
                    </td>
                    <td className="px-4 py-2 text-end font-mono text-xs">{formatMinor(invoice.subtotalAmountMinor)}</td>
                  </tr>
                  <tr className="text-sm">
                    <td colSpan={4} className="px-4 py-2 text-end text-muted-foreground">
                      {t('invoices.tableTax')}
                    </td>
                    <td className="px-4 py-2 text-end font-mono text-xs">{formatMinor(invoice.taxAmountMinor)}</td>
                  </tr>
                  <tr className="text-sm">
                    <td colSpan={4} className="px-4 py-2 text-end font-medium">
                      {t('invoices.tableTotal')}
                    </td>
                    <td className="px-4 py-2 text-end font-mono text-xs font-semibold">
                      {formatMinor(invoice.totalAmountMinor)}
                    </td>
                  </tr>
                  <tr className="text-sm">
                    <td colSpan={4} className="px-4 py-2 text-end text-muted-foreground">
                      {t('detail.paidAmount')}
                    </td>
                    <td className="px-4 py-2 text-end font-mono text-xs">
                      <span className="text-emerald-700 dark:text-emerald-400">
                        −{formatMinor(invoice.paidAmountMinor)}
                      </span>
                    </td>
                  </tr>
                  <tr className="text-sm">
                    <td colSpan={4} className="px-4 py-2 text-end font-medium">
                      {t('detail.balanceDue')}
                    </td>
                    <td className="px-4 py-2 text-end font-mono text-xs font-semibold">{formatMinor(balanceDue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Payment history timeline (ACC-9). */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('invoices.paymentHistory')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('invoices.noPayments')}</p>
            ) : (
              <ol className="space-y-3">
                {data.payments.map((payment) => (
                  <li
                    key={payment.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">{t(`invoices.methods.${payment.method}`)}</Badge>
                      <span className="text-sm text-muted-foreground">
                        {new Date(payment.receivedAt).toLocaleString(locale, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </span>
                      {payment.reference && (
                        <span className="font-mono text-xs text-muted-foreground" dir="auto">
                          {payment.reference}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {formatMinor(payment.allocationAmountMinor, payment.currency)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Credit-note trail (ACC-10). */}
        {data.creditNotes.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('invoices.creditNotesTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 text-start font-medium">{t('creditNotes.tableNumber')}</th>
                      <th className="px-3 py-2 text-start font-medium">{t('creditNotes.tableReason')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('creditNotes.tableCredited')}</th>
                      <th className="px-3 py-2 text-end font-medium">{t('creditNotes.tableStatus')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.creditNotes.map((note) => (
                      <tr key={note.id}>
                        <td className="px-3 py-2 font-mono text-xs">{note.creditNoteNumber}</td>
                        <td className="px-3 py-2 text-muted-foreground" dir="auto">
                          {note.reasonCode}
                        </td>
                        <td className="px-3 py-2 text-end font-mono text-xs">
                          {formatMinor(note.amountMinor, note.currency)}
                        </td>
                        <td className="px-3 py-2 text-end">
                          <Badge variant="secondary">{t('creditNotes.statusCredited')}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Record payment modal (ACC-9) ─────────────────────────────── */}
        {payOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pay-dialog-title"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/50 cursor-default"
              onClick={() => setPayOpen(false)}
              aria-hidden="true"
              tabIndex={-1}
            />
            <Card className="relative w-full max-w-md animate-fade-in">
              <CardHeader className="pb-3">
                <CardTitle id="pay-dialog-title" className="text-base">
                  {t('invoices.payDialogTitle', { invoice: invoice.invoiceNumber })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pay-amount">{t('invoices.fields.payAmount', { currency: invoice.currency })}</Label>
                    <Input
                      id="pay-amount"
                      className="font-mono"
                      inputMode="numeric"
                      value={payAmount}
                      onChange={(event) => setPayAmount(event.target.value.replace(/\D/g, ''))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pay-method">{t('invoices.fields.payMethod')}</Label>
                    <select
                      id="pay-method"
                      value={payMethod}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (isPaymentMethod(value)) setPayMethod(value);
                      }}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    >
                      {PAYMENT_METHODS.map((method) => (
                        <option key={method} value={method}>
                          {t(`invoices.methods.${method}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay-reference">{t('invoices.fields.payReference')}</Label>
                  <Input
                    id="pay-reference"
                    dir="auto"
                    value={payReference}
                    onChange={(event) => setPayReference(event.target.value)}
                  />
                </div>
              </CardContent>
              <CardFooter className="justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={() => setPayOpen(false)}>
                  {t('invoices.cancel')}
                </Button>
                <Button onClick={() => void handleApplyPayment()} loading={applyPayment.isPending}>
                  {t('invoices.pay')}
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}

        {/* ─── Journal entry detail modal (ACC-6) — opened in place, so the
             user stays on the invoice document. ────────────────────────── */}
        {journalEntryOpen && data.journalEntry && (
          <JournalEntryDetailModal entryId={data.journalEntry.id} onClose={() => setJournalEntryOpen(false)} />
        )}

        {/* ─── Issue credit note modal (ACC-10) ─────────────────────────── */}
        {creditOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="credit-dialog-title"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/50 cursor-default"
              onClick={() => setCreditOpen(false)}
              aria-hidden="true"
              tabIndex={-1}
            />
            <Card className="relative w-full max-w-lg animate-fade-in">
              <CardHeader className="pb-3">
                <CardTitle id="credit-dialog-title" className="text-base">
                  {t('creditNotes.modalTitle', { invoice: invoice.invoiceNumber })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="space-y-2">
                  <Label htmlFor="credit-reason">{t('creditNotes.fields.reasonCode')}</Label>
                  <Input
                    id="credit-reason"
                    dir="auto"
                    value={reasonCode}
                    placeholder={t('creditNotes.fields.reasonPlaceholder')}
                    onChange={(event) => setReasonCode(event.target.value)}
                    aria-invalid={reasonCode.trim() === '' ? true : undefined}
                  />
                  {reasonCode.trim() === '' && (
                    <p className="text-xs text-destructive">{t('creditNotes.fields.reasonRequired')}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">{t('creditNotes.fields.lines')}</p>
                  <div className="divide-y divide-border rounded-md border">
                    {creditLines.map((line, index) => (
                      <div key={line.invoiceLineId} className="grid gap-2 px-3 py-2 md:grid-cols-[auto_1fr_6rem_7rem]">
                        <input
                          type="checkbox"
                          className="mt-2 size-4 accent-primary"
                          checked={line.include}
                          onChange={(event) =>
                            setCreditLines((lines) =>
                              lines.map((l, i) => (i === index ? { ...l, include: event.target.checked } : l)),
                            )
                          }
                          aria-label={t('creditNotes.fields.includeLine')}
                        />
                        <div className="min-w-0 text-sm" dir="auto">
                          <span className="block truncate">{invoiceLineLabel(invoice.lines, line.invoiceLineId)}</span>
                        </div>
                        <Input
                          className="font-mono"
                          inputMode="numeric"
                          aria-label={t('creditNotes.fields.quantity')}
                          value={line.quantity}
                          disabled={!line.include}
                          onChange={(event) =>
                            setCreditLines((lines) =>
                              lines.map((l, i) => (i === index ? { ...l, quantity: event.target.value } : l)),
                            )
                          }
                        />
                        <Input
                          className="font-mono"
                          inputMode="numeric"
                          aria-label={t('creditNotes.fields.unitPrice')}
                          value={line.unitPriceMinor}
                          disabled={!line.include}
                          onChange={(event) =>
                            setCreditLines((lines) =>
                              lines.map((l, i) =>
                                i === index ? { ...l, unitPriceMinor: event.target.value.replace(/\D/g, '') } : l,
                              ),
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
              <CardFooter className="justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={() => setCreditOpen(false)}>
                  {t('invoices.cancel')}
                </Button>
                <Button
                  onClick={() => void handleIssueCreditNote()}
                  loading={issueCreditNote.isPending}
                  disabled={reasonCode.trim() === '' || !creditLines.some((line) => line.include)}
                >
                  {t('creditNotes.submit')}
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}
      </div>
    </ModuleGate>
  );
}

/** Resolve an invoice line's item name for the credit-note picker. */
function invoiceLineLabel(lines: AccountingInvoiceLine[], lineId: string): string {
  return lines.find((line) => line.id === lineId)?.itemNameSnapshot ?? lineId;
}
