'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Banknote, CheckCircle2, Plus, Receipt } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';

import type { PurchasingBill, PurchasingSupplier } from '@/lib/api/resources';

import { usePurchasingError } from './errors';
import {
  useCurrencies,
  useOrgBaseCurrency,
  usePurchasingBills,
  usePurchasingMutations,
  usePurchasingSuppliers,
} from './hooks';
import { formatMinorAmount, statusTone } from './labels';
import { PurchasingPageHeader } from './page-header';

const PAGE_SIZE = 20;
const BILL_STATUSES = ['draft', 'approved', 'partially_paid', 'paid', 'void'];

const billLineSchema = z.object({
  itemNameSnapshot: z.string().trim().min(1),
  quantity: z.string().min(1),
  unitCostMinor: z.string().min(1),
});

const billFormSchema = z.object({
  supplierId: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  lines: z.array(billLineSchema).min(1),
});

type BillFormValues = z.infer<typeof billFormSchema>;

/**
 * BillsView — purchase bills (PUR-6/7). Drafts are approved inline (three-way
 * match server-side); approved bills can have payments recorded against them.
 */
export function BillsView() {
  const t = useTranslations('modules.purchasing');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string, currency = baseCurrency) =>
    formatMinorAmount(amountMinor, currency, { locale, exponent });

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [range, setRange] = useState<{ q?: string; status?: string }>({});
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [payFor, setPayFor] = useState<PurchasingBill | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data, isPending } = usePurchasingBills({
    ...(range.q ? { q: range.q } : {}),
    ...(range.status ? { status: range.status } : {}),
    page,
    pageSize: PAGE_SIZE,
  });
  const { data: suppliersData } = usePurchasingSuppliers({ pageSize: 200 });
  const { createBill, approveBill, recordPayment } = usePurchasingMutations();
  const errorKey = usePurchasingError();

  const form = useForm<BillFormValues>({
    resolver: zodResolver(billFormSchema),
    defaultValues: {
      supplierId: '',
      currency: baseCurrency,
      lines: [{ itemNameSnapshot: '', quantity: '1', unitCostMinor: '' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setSuccess(null);
    try {
      await createBill.mutateAsync({
        supplierId: values.supplierId,
        currency: values.currency,
        lines: values.lines.map((line) => ({
          itemNameSnapshot: line.itemNameSnapshot,
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
        })),
      });
      setSuccess(t('bills.createdMessage'));
      form.reset({
        supplierId: '',
        currency: baseCurrency,
        lines: [{ itemNameSnapshot: '', quantity: '1', unitCostMinor: '' }],
      });
      setFormOpen(false);
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : undefined));
    }
  });

  const onApprove = async (id: string) => {
    setError(null);
    setSuccess(null);
    try {
      await approveBill.mutateAsync({ id });
      setSuccess(t('bills.approvedMessage'));
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : undefined));
    }
  };

  const onPay = async () => {
    if (!payFor) return;
    setError(null);
    setSuccess(null);
    try {
      await recordPayment.mutateAsync({
        supplierId: payFor.supplierId,
        method: paymentMethod,
        amountMinor: paymentAmount,
        currency: payFor.currency,
        allocations: [{ billId: payFor.id, amountMinor: paymentAmount }],
      });
      setSuccess(t('bills.paidMessage'));
      setPayFor(null);
      setPaymentAmount('');
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : undefined));
    }
  };

  const canPay = (bill: PurchasingBill) =>
    (bill.status === 'approved' || bill.status === 'partially_paid') &&
    Number(bill.paidMinor) < Number(bill.totalMinor);

  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5">
        <PurchasingPageHeader
          icon={Receipt}
          title={t('bills.title')}
          subtitle={t('bills.subtitle')}
          actions={
            <Button variant="outline" onClick={() => setFormOpen((open) => !open)}>
              <Plus />
              {formOpen ? t('common.hideForm') : t('bills.addAction')}
            </Button>
          }
        />

        {formOpen && (
          <Card>
            <CardHeader>
              <CardTitle>{t('bills.addTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="bill-supplier">{t('bills.supplier')}</Label>
                    <Select
                      value={form.watch('supplierId')}
                      onValueChange={(value) => form.setValue('supplierId', value)}
                    >
                      {(suppliersData?.items ?? []).map((supplier: PurchasingSupplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name} ({supplier.code})
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bill-currency">{t('bills.currency')}</Label>
                    <Input id="bill-currency" {...form.register('currency')} placeholder={baseCurrency} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('bills.lines')}</Label>
                  {fields.map((field, index) => (
                    <div key={field.id} className="grid gap-2 sm:grid-cols-[1fr_90px_140px_40px]">
                      <Input placeholder={t('bills.itemName')} {...form.register(`lines.${index}.itemNameSnapshot`)} />
                      <Input placeholder={t('bills.quantity')} {...form.register(`lines.${index}.quantity`)} />
                      <Input placeholder={t('bills.unitCost')} {...form.register(`lines.${index}.unitCostMinor`)} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('common.remove')}
                        onClick={() => remove(index)}
                      >
                        <Plus className="rotate-45" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ itemNameSnapshot: '', quantity: '1', unitCostMinor: '' })}
                  >
                    <Plus />
                    {t('bills.addLine')}
                  </Button>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}
                {success && <p className="text-sm text-emerald-600">{success}</p>}
                <div className="flex justify-end">
                  <Button type="submit" disabled={createBill.isPending}>
                    {t('bills.submit')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row">
              <Input
                placeholder={t('bills.searchPlaceholder')}
                value={q}
                onChange={(event) => setQ(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setRange({ q, status });
                    setPage(1);
                  }
                }}
                className="sm:max-w-xs"
              />
              <Select value={status} onValueChange={setStatus}>
                <SelectItem value="">{t('bills.filterAll')}</SelectItem>
                {BILL_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`bills.statuses.${value}`)}
                  </SelectItem>
                ))}
              </Select>
              <Button
                variant="outline"
                onClick={() => {
                  setRange({ q, status });
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
                      <th className="py-2 pe-4 text-start font-medium">{t('bills.number')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('bills.supplier')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('bills.status')}</th>
                      <th className="py-2 pe-4 text-end font-medium">{t('bills.total')}</th>
                      <th className="py-2 text-start font-medium">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.items ?? []).map((bill: PurchasingBill) => (
                      <tr key={bill.id} className="border-b">
                        <td className="py-2 pe-4">
                          <a
                            href={`/m/purchasing/bills/${bill.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {bill.number}
                          </a>
                        </td>
                        <td className="py-2 pe-4">{bill.supplierNameSnapshot}</td>
                        <td className="py-2 pe-4">
                          <Badge variant={statusTone(bill.status)}>{t(`bills.statuses.${bill.status}`)}</Badge>
                        </td>
                        <td className="py-2 pe-4 text-end">{formatMinor(bill.totalMinor, bill.currency)}</td>
                        <td className="py-2">
                          <div className="flex gap-2">
                            {bill.status === 'draft' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void onApprove(bill.id)}
                                disabled={approveBill.isPending}
                              >
                                <CheckCircle2 />
                                {t('bills.approve')}
                              </Button>
                            )}
                            {canPay(bill) && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setPayFor(bill);
                                  setPaymentAmount(String(Number(bill.totalMinor) - Number(bill.paidMinor)));
                                  setPaymentMethod('bank_transfer');
                                }}
                              >
                                <Banknote />
                                {t('bills.pay')}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {(data?.items ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                          {t('bills.empty')}
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

      {payFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>
                {t('bills.payTitle')} · {payFor.number}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pay-amount">{t('bills.payAmount')}</Label>
                <Input
                  id="pay-amount"
                  type="number"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pay-method">{t('bills.payMethod')}</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  {['cash', 'bank_transfer', 'card', 'cheque', 'other'].map((method) => (
                    <SelectItem key={method} value={method}>
                      {t(`payments.methods.${method}`)}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPayFor(null)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={() => void onPay()} disabled={recordPayment.isPending}>
                  {t('bills.confirmPay')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </ModuleGate>
  );
}
