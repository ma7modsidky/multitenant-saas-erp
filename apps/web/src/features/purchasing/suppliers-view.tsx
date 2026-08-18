'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';

import type { PurchasingSupplier } from '@/lib/api/resources';

import { usePurchasingError } from './errors';
import { useCurrencies, useOrgBaseCurrency, usePurchasingMutations, usePurchasingSuppliers } from './hooks';
import { formatMinorAmount } from './labels';
import { PurchasingPageHeader } from './page-header';

const PAGE_SIZE = 20;

const supplierFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  taxId: z.string().trim().max(50).optional(),
  contactName: z.string().trim().max(200).optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().trim().max(50).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  netDays: z.coerce.number().int().min(0).max(365).optional(),
});

type SupplierFormValues = z.infer<typeof supplierFormSchema>;

/**
 * SuppliersView — the supplier directory (PUR-1): code, name, tax id, payment
 * terms and the derived vendor balance (PUR-2). The create form is collapsed
 * by default; every supplier links to its detail page (ledger + balance).
 */
export function SuppliersView() {
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

  const { data, isPending } = usePurchasingSuppliers({ ...(range.q ? { q: range.q } : {}), page, pageSize: PAGE_SIZE });
  const { createSupplier } = usePurchasingMutations();
  const errorKey = usePurchasingError();

  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: {
      name: '',
      taxId: '',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      currency: baseCurrency,
      netDays: 30,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setSuccess(null);
    try {
      await createSupplier.mutateAsync({
        name: values.name,
        ...(values.taxId ? { taxId: values.taxId } : {}),
        ...(values.contactName ? { contactName: values.contactName } : {}),
        ...(values.contactEmail ? { contactEmail: values.contactEmail } : {}),
        ...(values.contactPhone ? { contactPhone: values.contactPhone } : {}),
        ...(values.currency ? { currency: values.currency } : {}),
        paymentTerms: { netDays: values.netDays ?? 30, discountDays: 0, discountRateBp: 0 },
      });
      setSuccess(t('suppliers.createdMessage'));
      form.reset();
      setFormOpen(false);
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : undefined));
    }
  });

  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5">
        <PurchasingPageHeader
          icon={Users}
          title={t('suppliers.title')}
          subtitle={t('suppliers.subtitle')}
          actions={
            <Button variant="outline" onClick={() => setFormOpen((open) => !open)}>
              <Plus />
              {formOpen ? t('common.hideForm') : t('suppliers.addAction')}
            </Button>
          }
        />

        {formOpen && (
          <Card>
            <CardHeader>
              <CardTitle>{t('suppliers.addTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="supplier-name">{t('suppliers.name')}</Label>
                    <Input id="supplier-name" {...form.register('name')} placeholder="Acme Supplies" />
                    {form.formState.errors.name && (
                      <p className="text-sm text-destructive">{t('suppliers.nameRequired')}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="supplier-tax">{t('suppliers.taxId')}</Label>
                    <Input id="supplier-tax" {...form.register('taxId')} placeholder="TAX-123456" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="supplier-currency">{t('suppliers.currency')}</Label>
                    <Input id="supplier-currency" {...form.register('currency')} placeholder={baseCurrency} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="supplier-contact">{t('suppliers.contactName')}</Label>
                    <Input id="supplier-contact" {...form.register('contactName')} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="supplier-email">{t('suppliers.contactEmail')}</Label>
                    <Input id="supplier-email" type="email" {...form.register('contactEmail')} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="supplier-netdays">{t('suppliers.netDays')}</Label>
                    <Input id="supplier-netdays" type="number" {...form.register('netDays')} />
                  </div>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                {success && <p className="text-sm text-emerald-600">{success}</p>}
                <div className="flex justify-end">
                  <Button type="submit" disabled={createSupplier.isPending}>
                    {t('suppliers.submit')}
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
                placeholder={t('suppliers.searchPlaceholder')}
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
                      <th className="py-2 pe-4 text-start font-medium">{t('suppliers.code')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('suppliers.name')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('suppliers.taxId')}</th>
                      <th className="py-2 pe-4 text-end font-medium">{t('suppliers.balance')}</th>
                      <th className="py-2 text-start font-medium">{t('suppliers.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.items ?? []).map((supplier: PurchasingSupplier) => (
                      <tr key={supplier.id} className="border-b">
                        <td className="py-2 pe-4">
                          <Link
                            href={`/m/purchasing/suppliers/${supplier.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {supplier.code}
                          </Link>
                        </td>
                        <td className="py-2 pe-4">{supplier.name}</td>
                        <td className="py-2 pe-4">{supplier.taxId ?? '—'}</td>
                        <td className="py-2 pe-4 text-end">{formatMinor(supplier.balanceMinor, supplier.currency)}</td>
                        <td className="py-2">
                          <Badge variant={supplier.isActive ? 'default' : 'secondary'}>
                            {supplier.isActive ? t('suppliers.active') : t('suppliers.inactive')}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                    {(data?.items ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                          {t('suppliers.empty')}
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
