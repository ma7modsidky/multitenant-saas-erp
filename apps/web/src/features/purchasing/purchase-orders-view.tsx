'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, FileText, Plus, Trash2 } from 'lucide-react';
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

import type { PurchasingPurchaseOrder, PurchasingSupplier } from '@/lib/api/resources';

import { usePurchasingError } from './errors';
import {
  useCurrencies,
  useOrgBaseCurrency,
  usePurchasingMutations,
  usePurchasingPurchaseOrders,
  usePurchasingSuppliers,
} from './hooks';
import { formatMinorAmount, statusTone } from './labels';
import { PurchasingPageHeader } from './page-header';

const PAGE_SIZE = 20;
const PO_STATUSES = ['draft', 'pending_approval', 'approved', 'partially_received', 'received', 'closed', 'cancelled'];

const lineSchema = z.object({
  itemNameSnapshot: z.string().trim().min(1),
  quantity: z.string().min(1),
  unitCostMinor: z.string().min(1),
});

const poFormSchema = z.object({
  supplierId: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  lines: z.array(lineSchema).min(1),
});

type PoFormValues = z.infer<typeof poFormSchema>;

/**
 * PurchaseOrdersView — the PO list (PUR-3/8): lifecycle status, supplier
 * snapshot, total. Drafts can be approved inline; every PO links to its
 * detail page. The create form is collapsed by default (table-first).
 */
export function PurchaseOrdersView() {
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data, isPending } = usePurchasingPurchaseOrders({
    ...(range.q ? { q: range.q } : {}),
    ...(range.status ? { status: range.status } : {}),
    page,
    pageSize: PAGE_SIZE,
  });
  const { data: suppliersData } = usePurchasingSuppliers({ pageSize: 200 });
  const { createPurchaseOrder, approvePurchaseOrder } = usePurchasingMutations();
  const errorKey = usePurchasingError();

  const form = useForm<PoFormValues>({
    resolver: zodResolver(poFormSchema),
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
      await createPurchaseOrder.mutateAsync({
        supplierId: values.supplierId,
        currency: values.currency,
        lines: values.lines.map((line) => ({
          itemNameSnapshot: line.itemNameSnapshot,
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
        })),
      });
      setSuccess(t('purchaseOrders.createdMessage'));
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
      await approvePurchaseOrder.mutateAsync(id);
      setSuccess(t('purchaseOrders.approvedMessage'));
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : undefined));
    }
  };

  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5">
        <PurchasingPageHeader
          icon={FileText}
          title={t('purchaseOrders.title')}
          subtitle={t('purchaseOrders.subtitle')}
          actions={
            <Button variant="outline" onClick={() => setFormOpen((open) => !open)}>
              <Plus />
              {formOpen ? t('common.hideForm') : t('purchaseOrders.addAction')}
            </Button>
          }
        />

        {formOpen && (
          <Card>
            <CardHeader>
              <CardTitle>{t('purchaseOrders.addTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="po-supplier">{t('purchaseOrders.supplier')}</Label>
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
                    {form.formState.errors.supplierId && (
                      <p className="text-sm text-destructive">{t('purchaseOrders.supplierRequired')}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="po-currency">{t('purchaseOrders.currency')}</Label>
                    <Input id="po-currency" {...form.register('currency')} placeholder={baseCurrency} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('purchaseOrders.lines')}</Label>
                  {fields.map((field, index) => (
                    <div key={field.id} className="grid gap-2 sm:grid-cols-[1fr_90px_140px_40px]">
                      <Input
                        placeholder={t('purchaseOrders.itemName')}
                        {...form.register(`lines.${index}.itemNameSnapshot`)}
                      />
                      <Input placeholder={t('purchaseOrders.quantity')} {...form.register(`lines.${index}.quantity`)} />
                      <Input
                        placeholder={t('purchaseOrders.unitCost')}
                        {...form.register(`lines.${index}.unitCostMinor`)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('common.remove')}
                        onClick={() => remove(index)}
                      >
                        <Trash2 />
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
                    {t('purchaseOrders.addLine')}
                  </Button>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}
                {success && <p className="text-sm text-emerald-600">{success}</p>}
                <div className="flex justify-end">
                  <Button type="submit" disabled={createPurchaseOrder.isPending}>
                    {t('purchaseOrders.submit')}
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
                placeholder={t('purchaseOrders.searchPlaceholder')}
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
              <Select value={status} onValueChange={(value) => setStatus(value)}>
                <SelectItem value="">{t('purchaseOrders.filterAll')}</SelectItem>
                {PO_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`purchaseOrders.statuses.${value}`)}
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
                      <th className="py-2 pe-4 text-start font-medium">{t('purchaseOrders.number')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('purchaseOrders.supplier')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('purchaseOrders.status')}</th>
                      <th className="py-2 pe-4 text-end font-medium">{t('purchaseOrders.total')}</th>
                      <th className="py-2 text-start font-medium">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.items ?? []).map((po: PurchasingPurchaseOrder) => (
                      <tr key={po.id} className="border-b">
                        <td className="py-2 pe-4">
                          <a
                            href={`/m/purchasing/purchase-orders/${po.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {po.number}
                          </a>
                        </td>
                        <td className="py-2 pe-4">{po.supplierNameSnapshot}</td>
                        <td className="py-2 pe-4">
                          <Badge variant={statusTone(po.status)}>{t(`purchaseOrders.statuses.${po.status}`)}</Badge>
                        </td>
                        <td className="py-2 pe-4 text-end">{formatMinor(po.totalMinor, po.currency)}</td>
                        <td className="py-2">
                          {po.status === 'draft' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void onApprove(po.id)}
                              disabled={approvePurchaseOrder.isPending}
                            >
                              <CheckCircle2 />
                              {t('purchaseOrders.approve')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(data?.items ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                          {t('purchaseOrders.empty')}
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
