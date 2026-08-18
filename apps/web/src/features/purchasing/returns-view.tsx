'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, Plus, Undo2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';

import type { PurchasingSupplier, PurchasingSupplierReturn } from '@/lib/api/resources';

import { usePurchasingError } from './errors';
import {
  useCurrencies,
  useOrgBaseCurrency,
  usePurchasingMutations,
  usePurchasingReturns,
  usePurchasingSuppliers,
} from './hooks';
import { formatMinorAmount, statusTone } from './labels';
import { PurchasingPageHeader } from './page-header';

const PAGE_SIZE = 20;

const returnFormSchema = z.object({
  supplierId: z.string().min(1),
  reasonCode: z.string().trim().min(1),
  quantity: z.string().min(1),
  unitCostMinor: z.string().min(1),
});

type ReturnFormValues = z.infer<typeof returnFormSchema>;

/**
 * ReturnsView — supplier returns / debit notes (PUR-11). Drafts carry a reason
 * code and the returned quantity × unit cost; approval removes stock and
 * reduces AP server-side.
 */
export function ReturnsView() {
  const t = useTranslations('modules.purchasing');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string, currency = baseCurrency) =>
    formatMinorAmount(amountMinor, currency, { locale, exponent });

  const [q, setQ] = useState('');
  const [range, setRange] = useState<{ q?: string }>({});
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data, isPending } = usePurchasingReturns({ ...(range.q ? { q: range.q } : {}), page, pageSize: PAGE_SIZE });
  const { data: suppliersData } = usePurchasingSuppliers({ pageSize: 200 });
  const { createReturn, approveReturn } = usePurchasingMutations();
  const errorKey = usePurchasingError();

  const form = useForm<ReturnFormValues>({
    resolver: zodResolver(returnFormSchema),
    defaultValues: { supplierId: '', reasonCode: '', quantity: '1', unitCostMinor: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setSuccess(null);
    try {
      await createReturn.mutateAsync({
        supplierId: values.supplierId,
        reasonCode: values.reasonCode,
        currency: baseCurrency,
        lines: [{ quantity: values.quantity, unitCostMinor: values.unitCostMinor }],
      });
      setSuccess(t('returns.createdMessage'));
      form.reset();
      setFormOpen(false);
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : undefined));
    }
  });

  const onApprove = async (id: string) => {
    setError(null);
    setSuccess(null);
    try {
      await approveReturn.mutateAsync({ id });
      setSuccess(t('returns.approvedMessage'));
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : undefined));
    }
  };

  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5">
        <PurchasingPageHeader
          icon={Undo2}
          title={t('returns.title')}
          subtitle={t('returns.subtitle')}
          actions={
            <Button variant="outline" onClick={() => setFormOpen((open) => !open)}>
              <Plus />
              {formOpen ? t('common.hideForm') : t('returns.addAction')}
            </Button>
          }
        />

        {formOpen && (
          <Card>
            <CardHeader>
              <CardTitle>{t('returns.addTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="return-supplier">{t('returns.supplier')}</Label>
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
                    <Label htmlFor="return-reason">{t('returns.reasonCode')}</Label>
                    <Input
                      id="return-reason"
                      {...form.register('reasonCode')}
                      placeholder="defective / damaged / wrong item"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="return-qty">{t('returns.quantity')}</Label>
                    <Input id="return-qty" {...form.register('quantity')} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="return-cost">{t('returns.unitCost')}</Label>
                    <Input id="return-cost" {...form.register('unitCostMinor')} />
                  </div>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                {success && <p className="text-sm text-emerald-600">{success}</p>}
                <div className="flex justify-end">
                  <Button type="submit" disabled={createReturn.isPending}>
                    {t('returns.submit')}
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
                placeholder={t('returns.searchPlaceholder')}
                value={q}
                onChange={(event) => setQ(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setRange({ q });
                    setPage(1);
                  }
                }}
                className="sm:max-w-xs"
              />
              <Button
                variant="outline"
                onClick={() => {
                  setRange({ q });
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
                      <th className="py-2 pe-4 text-start font-medium">{t('returns.number')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('returns.supplier')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('returns.reasonCode')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('returns.status')}</th>
                      <th className="py-2 pe-4 text-end font-medium">{t('returns.amount')}</th>
                      <th className="py-2 text-start font-medium">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.items ?? []).map((ret: PurchasingSupplierReturn) => (
                      <tr key={ret.id} className="border-b">
                        <td className="py-2 pe-4 font-medium">{ret.number}</td>
                        <td className="py-2 pe-4">{ret.supplierNameSnapshot}</td>
                        <td className="py-2 pe-4">{ret.reasonCode}</td>
                        <td className="py-2 pe-4">
                          <Badge variant={statusTone(ret.status)}>{t(`returns.statuses.${ret.status}`)}</Badge>
                        </td>
                        <td className="py-2 pe-4 text-end">{formatMinor(ret.amountMinor, ret.currency)}</td>
                        <td className="py-2">
                          {ret.status === 'draft' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void onApprove(ret.id)}
                              disabled={approveReturn.isPending}
                            >
                              <CheckCircle2 />
                              {t('returns.approve')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(data?.items ?? []).length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted-foreground">
                          {t('returns.empty')}
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
