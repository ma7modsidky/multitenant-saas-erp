'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, FileText, Plus, Trash2, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';
import { Can } from '@/lib/permissions';

import { accountingErrorKey } from './errors';
import {
  useAccountingInvoices,
  useAccountingMutations,
  useAccountingTaxRates,
  useCurrencies,
  useOrgBaseCurrency,
} from './hooks';
import { formatMinorAmount } from './labels';
import { AccountingPageHeader } from './page-header';

import type { AccountingTaxRate } from '@/lib/api/resources';

const invoiceLineSchema = z.object({
  itemName: z.string().min(1),
  quantity: z.string().regex(/^\d+(\.\d+)?$/, 'quantity must be a decimal string'),
  unitPriceMinor: z.string().regex(/^\d+$/, 'unit price must be an integer (minor units)'),
  taxRateId: z.string().optional(),
  taxRateBp: z.string().regex(/^\d*$/, 'tax rate must be an integer (basis points)'),
});

const issueInvoiceSchema = z.object({
  customerName: z.string().min(1),
  customerTaxId: z.string().max(50).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use the YYYY-MM-DD format'),
  currency: z.string().regex(/^[A-Z]{3}$/),
  lines: z.array(invoiceLineSchema).min(1),
});

type IssueInvoiceFormValues = z.infer<typeof issueInvoiceSchema>;

/**
 * InvoicesView — issue customer invoices (ACC-6/7/8) with multi-line items and
 * per-line tax (ACC-11), list the AR lifecycle, and apply payments (ACC-9).
 */
export function InvoicesView() {
  const t = useTranslations('modules.accounting');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, baseCurrency, { locale, exponent });

  // The create-invoice form is collapsed by default so the AR table is the
  // primary focus on load; '+ Create invoice' expands it.
  const [formOpen, setFormOpen] = useState(false);
  // Search (invoice number / customer) + status filter + pagination.
  const [q, setQ] = useState('');
  const [range, setRange] = useState<{ q?: string; status?: string }>({});
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const { data: invoices, isPending } = useAccountingInvoices({
    ...(range.q ? { q: range.q } : {}),
    ...(range.status ? { status: range.status } : {}),
    page,
    pageSize: PAGE_SIZE,
  });
  const { issueInvoice, applyPayment } = useAccountingMutations();
  const { data: taxRates } = useAccountingTaxRates();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const totalPages = invoices ? Math.max(1, Math.ceil(invoices.total / invoices.pageSize)) : 1;

  /** ACC-11: applying a catalog rate sets both the rate id (GL + record) and its bp. */
  const applyTaxRate = (index: number, rate: AccountingTaxRate | null) => {
    form.setValue(`lines.${index}.taxRateId`, rate?.id ?? '');
    form.setValue(`lines.${index}.taxRateBp`, rate ? String(rate.rateBp) : '');
  };

  /** Status filter — All + the AR lifecycle states (ACC-8). */
  const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
    { value: '', label: t('invoices.filterAll') },
    { value: 'issued', label: t('invoices.statusIssued') },
    { value: 'paid', label: t('invoices.statusPaid') },
    { value: 'partially_paid', label: t('invoices.statusPartiallyPaid') },
    { value: 'overdue', label: t('invoices.statusOverdue') },
    { value: 'void', label: t('invoices.statusVoid') },
  ];
  const hasActiveFilters = range.q !== undefined || (range.status !== undefined && range.status !== '');

  // Payment dialog state (ACC-9).
  const [payInvoiceId, setPayInvoiceId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other'>('cash');
  const [payReference, setPayReference] = useState('');

  const form = useForm<IssueInvoiceFormValues>({
    resolver: zodResolver(issueInvoiceSchema),
    defaultValues: {
      customerName: '',
      customerTaxId: '',
      dueDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      currency: baseCurrency,
      lines: [{ itemName: '', quantity: '1', unitPriceMinor: '', taxRateId: '', taxRateBp: '' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });

  const handleIssue = async (values: IssueInvoiceFormValues) => {
    setError(null);
    setSuccess(null);
    try {
      const result = await issueInvoice.mutateAsync({
        customerName: values.customerName,
        ...(values.customerTaxId ? { customerTaxId: values.customerTaxId } : {}),
        dueDate: values.dueDate,
        currency: values.currency,
        lines: values.lines.map((line) => ({
          itemName: line.itemName,
          quantity: line.quantity,
          unitPrice: { amountMinor: line.unitPriceMinor, currency: values.currency },
          ...(line.taxRateId ? { taxRateId: line.taxRateId } : {}),
          ...(line.taxRateBp ? { taxRateBp: Number(line.taxRateBp) } : {}),
        })),
      });
      setSuccess(t('invoices.issuedMessage', { invoiceNumber: result.invoiceNumber }));
      form.reset({
        customerName: '',
        customerTaxId: '',
        dueDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        currency: values.currency,
        lines: [{ itemName: '', quantity: '1', unitPriceMinor: '', taxRateId: '', taxRateBp: '' }],
      });
    } catch (err) {
      setError(err instanceof ApiError ? t(accountingErrorKey(err.code)) : t('errors.unknown'));
    }
  };

  const handleApplyPayment = async () => {
    if (!payInvoiceId) return;
    setError(null);
    setSuccess(null);
    try {
      await applyPayment.mutateAsync({
        invoiceId: payInvoiceId,
        method: payMethod,
        amount: { amountMinor: payAmount || '0', currency: baseCurrency },
        ...(payReference ? { reference: payReference } : {}),
      });
      setSuccess(t('invoices.paymentAppliedMessage'));
      setPayInvoiceId(null);
      setPayAmount('');
      setPayReference('');
    } catch (err) {
      setError(err instanceof ApiError ? t(accountingErrorKey(err.code)) : t('errors.unknown'));
    }
  };

  const payTarget = invoices?.items.find((invoice) => invoice.id === payInvoiceId) ?? null;

  /** Payment method values — mirrors `ApplyPaymentInput['method']` and the API enum. */
  type PaymentMethodValue = 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other';
  // A readonly typed array avoids an `as const` cast (no-restricted-syntax).
  const PAYMENT_METHODS: readonly PaymentMethodValue[] = ['cash', 'bank_transfer', 'card', 'cheque', 'other'];
  const isPaymentMethod = (value: string): value is PaymentMethodValue =>
    PAYMENT_METHODS.some((method) => method === value);

  const statusKey = (status: string) => {
    switch (status) {
      case 'issued':
        return t('invoices.statusIssued');
      case 'partially_paid':
        return t('invoices.statusPartiallyPaid');
      case 'paid':
        return t('invoices.statusPaid');
      case 'overdue':
        return t('invoices.statusOverdue');
      case 'void':
        return t('invoices.statusVoid');
      default:
        return t('invoices.statusDraft');
    }
  };

  /** ACC-8/ACC-9: which statuses may still record a payment. */
  const canPay = (status: string) => status === 'issued' || status === 'partially_paid' || status === 'overdue';

  return (
    <ModuleGate moduleKey="accounting">
      <div className="space-y-6 animate-fade-in">
        <AccountingPageHeader
          icon={FileText}
          title={t('invoices.title')}
          subtitle={t('invoices.subtitle')}
          actions={
            <Can permission="accounting:invoice:write">
              <Button
                variant={formOpen ? 'outline' : 'default'}
                onClick={() => setFormOpen((open) => !open)}
                aria-expanded={formOpen}
              >
                <Plus className="size-4" aria-hidden="true" />
                <span className="ms-1">{formOpen ? t('invoices.hideForm') : t('invoices.createInvoice')}</span>
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

        <Can permission="accounting:invoice:write">
          {formOpen && (
            <Card className="border-primary/20">
              <CardContent className="pt-6">
                <form className="space-y-4" onSubmit={(event) => void form.handleSubmit(handleIssue)(event)}>
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="space-y-2">
                      <Label htmlFor="invoice-customer">{t('invoices.fields.customerName')}</Label>
                      <Input id="invoice-customer" dir="auto" {...form.register('customerName')} />
                      {form.formState.errors.customerName && (
                        <p className="text-xs text-destructive">{form.formState.errors.customerName.message}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invoice-tax-id">{t('invoices.fields.customerTaxId')}</Label>
                      <Input id="invoice-tax-id" dir="auto" {...form.register('customerTaxId')} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invoice-due">{t('invoices.fields.dueDate')}</Label>
                      <Input id="invoice-due" type="date" {...form.register('dueDate')} />
                      {form.formState.errors.dueDate && (
                        <p className="text-xs text-destructive">{form.formState.errors.dueDate.message}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invoice-currency">{t('invoices.fields.currency')}</Label>
                      <Input id="invoice-currency" className="font-mono uppercase" {...form.register('currency')} />
                      {form.formState.errors.currency && (
                        <p className="text-xs text-destructive">{form.formState.errors.currency.message}</p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t('invoices.fields.lines')}</p>
                    <div className="divide-y divide-border rounded-md border">
                      {fields.map((field, index) => {
                        const lineErrors = form.formState.errors.lines?.[index];
                        return (
                          <div
                            key={field.id}
                            className="grid gap-2 px-3 py-2 md:grid-cols-[1fr_6rem_8rem_9rem_8rem_auto]"
                          >
                            <div className="min-w-0 space-y-1">
                              <Input
                                dir="auto"
                                placeholder={t('invoices.fields.itemName')}
                                aria-label={t('invoices.fields.itemName')}
                                {...form.register(`lines.${index}.itemName`)}
                              />
                              {lineErrors?.itemName && (
                                <p className="text-xs text-destructive">{lineErrors.itemName.message}</p>
                              )}
                            </div>
                            <div className="space-y-1">
                              <Input
                                className="font-mono"
                                inputMode="decimal"
                                placeholder={t('invoices.fields.quantity')}
                                aria-label={t('invoices.fields.quantity')}
                                {...form.register(`lines.${index}.quantity`)}
                              />
                              {lineErrors?.quantity && (
                                <p className="text-xs text-destructive">{lineErrors.quantity.message}</p>
                              )}
                            </div>
                            <div className="space-y-1">
                              <Input
                                className="font-mono"
                                inputMode="numeric"
                                placeholder={t('invoices.fields.unitPrice')}
                                aria-label={t('invoices.fields.unitPrice')}
                                {...form.register(`lines.${index}.unitPriceMinor`)}
                              />
                              {lineErrors?.unitPriceMinor && (
                                <p className="text-xs text-destructive">{lineErrors.unitPriceMinor.message}</p>
                              )}
                            </div>
                            <div className="space-y-1">
                              <Select
                                id={`invoice-line-${index}-tax-rate`}
                                value={form.watch(`lines.${index}.taxRateId`) ?? ''}
                                onValueChange={(value) => {
                                  const rate =
                                    (taxRates?.items ?? []).find((candidate) => candidate.id === value) ?? null;
                                  applyTaxRate(index, rate);
                                }}
                              >
                                <SelectItem value="">{t('invoices.fields.taxRateNone')}</SelectItem>
                                {(taxRates?.items ?? []).map((rate) => (
                                  <SelectItem key={rate.id} value={rate.id}>
                                    {rate.nameI18n.en ?? rate.code} ({rate.rateBp / 100}%)
                                  </SelectItem>
                                ))}
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Input
                                className="font-mono"
                                inputMode="numeric"
                                placeholder={t('invoices.fields.taxRateBp')}
                                aria-label={t('invoices.fields.taxRateBp')}
                                {...form.register(`lines.${index}.taxRateBp`)}
                              />
                              {lineErrors?.taxRateBp && (
                                <p className="text-xs text-destructive">{lineErrors.taxRateBp.message}</p>
                              )}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="justify-self-end"
                              onClick={() => remove(index)}
                              disabled={fields.length === 1}
                              aria-label={t('invoices.removeLine')}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        append({ itemName: '', quantity: '1', unitPriceMinor: '', taxRateId: '', taxRateBp: '' })
                      }
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      <span className="ms-1">{t('invoices.addLine')}</span>
                    </Button>
                  </div>

                  <Button loading={issueInvoice.isPending}>{t('invoices.submit')}</Button>
                </form>
              </CardContent>
            </Card>
          )}
        </Can>

        {/* Search + status filter above the AR table (server-side). */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="invoice-search">{t('invoices.search')}</Label>
            <Input
              id="invoice-search"
              type="search"
              dir="auto"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={t('invoices.searchPlaceholder')}
            />
          </div>
          <div className="w-44 space-y-1">
            <Label htmlFor="invoice-status-filter">{t('invoices.filterStatus')}</Label>
            <Select
              id="invoice-status-filter"
              value={range.status ?? ''}
              onValueChange={(value) => {
                setPage(1);
                setRange((current) => {
                  const next = { ...current };
                  if (value === '') delete next.status;
                  else next.status = value;
                  return next;
                });
              }}
            >
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value || 'all'} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </Select>
          </div>
          <Button
            size="sm"
            disabled={q === ''}
            onClick={() => {
              setPage(1);
              const trimmed = q.trim();
              setRange((current) => {
                const next: { q?: string; status?: string } = { ...current };
                if (trimmed !== '') next.q = trimmed;
                else delete next.q;
                return next;
              });
            }}
          >
            {t('invoices.apply')}
          </Button>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ('');
                setRange({});
                setPage(1);
              }}
            >
              {t('invoices.clear')}
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('invoices.tableNumber')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('invoices.tableCustomer')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('invoices.tableDate')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('invoices.tableTotal')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('invoices.tableStatus')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('invoices.tableActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isPending && !invoices ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        {t('common.loading')}
                      </td>
                    </tr>
                  ) : (invoices?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        {t('invoices.empty')}
                      </td>
                    </tr>
                  ) : (
                    invoices?.items.map((invoice) => (
                      <tr key={invoice.id} className="transition-colors hover:bg-accent/30">
                        <td className="px-4 py-3 font-mono text-xs">
                          <Link
                            href={`/${locale}/m/accounting/invoices/${invoice.id}`}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {invoice.invoiceNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-medium" dir="auto">
                          <Link
                            href={`/${locale}/m/accounting/invoices/${invoice.id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {invoice.customerNameSnapshot}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{invoice.invoiceDate}</td>
                        <td className="px-4 py-3 text-end font-mono text-xs">
                          {formatMinor(invoice.totalAmountMinor)}
                        </td>
                        <td className="px-4 py-3 text-end">
                          <Badge variant={invoice.status === 'paid' ? 'secondary' : 'outline'}>
                            {statusKey(invoice.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-end">
                          <div className="flex items-center justify-end gap-1">
                            <Button asChild variant="ghost" size="sm">
                              <Link href={`/${locale}/m/accounting/invoices/${invoice.id}`}>
                                <Eye className="size-4" aria-hidden="true" />
                                <span className="ms-1">{t('invoices.view')}</span>
                              </Link>
                            </Button>
                            {/* ACC-8/ACC-9: Pay only while money is still owed —
                                Issued / Overdue (and partially paid) show Pay;
                                Paid hides Pay and shows the Paid badge + View. */}
                            {canPay(invoice.status) && (
                              <Can permission="accounting:payment:apply">
                                <Button variant="outline" size="sm" onClick={() => setPayInvoiceId(invoice.id)}>
                                  <Wallet className="size-4" aria-hidden="true" />
                                  <span className="ms-1">{t('invoices.pay')}</span>
                                </Button>
                              </Can>
                            )}
                          </div>
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
        {invoices && invoices.total > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <p className="text-xs text-muted-foreground">
              {t('invoices.shownCount', {
                shown: String(Math.min(invoices.total, (page - 1) * PAGE_SIZE + (invoices.items.length || PAGE_SIZE))),
                total: String(invoices.total),
              })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                {t('invoices.previous')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t('invoices.pageOf', { page: String(invoices.page), total: String(totalPages) })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                {t('invoices.next')}
              </Button>
            </div>
          </div>
        )}

        {payTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pay-dialog-title"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/50 cursor-default"
              onClick={() => setPayInvoiceId(null)}
              aria-hidden="true"
              tabIndex={-1}
            />
            <Card className="relative w-full max-w-md animate-fade-in">
              <CardHeader className="pb-3">
                <CardTitle id="pay-dialog-title" className="text-base">
                  {t('invoices.payDialogTitle', { invoice: payTarget.invoiceNumber })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pay-amount">{t('invoices.fields.payAmount', { currency: baseCurrency })}</Label>
                    <Input
                      id="pay-amount"
                      className="font-mono"
                      inputMode="numeric"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pay-method">{t('invoices.fields.payMethod')}</Label>
                    <select
                      id="pay-method"
                      value={payMethod}
                      onChange={(e) => {
                        const value = e.target.value;
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
                    onChange={(e) => setPayReference(e.target.value)}
                  />
                </div>
              </CardContent>
              <CardFooter className="justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={() => setPayInvoiceId(null)}>
                  {t('invoices.cancel')}
                </Button>
                <Button onClick={() => void handleApplyPayment()} loading={applyPayment.isPending}>
                  {t('invoices.pay')}
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}
      </div>
    </ModuleGate>
  );
}
