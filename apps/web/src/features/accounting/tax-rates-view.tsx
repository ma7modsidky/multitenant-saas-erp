'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Percent, Pencil, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import type { AccountingTaxRate } from '@/lib/api/resources';
import { Can } from '@/lib/permissions';

import { accountingErrorKey } from './errors';
import { useAccountingCoa, useAccountingMutations, useAccountingTaxRates } from './hooks';
import { accountDisplayName } from './labels';
import { AccountingPageHeader } from './page-header';

/**
 * Integer-safe percent → basis-points conversion (hard rule #3 — no float
 * arithmetic on money or rates). "15" → 1500, "2.5" → 250, "0" → 0.
 */
function percentToBp(percent: string): number {
  const [major, fraction = ''] = percent.trim().split('.');
  const frac = (fraction + '00').slice(0, 2);
  return Number(major) * 100 + Number(frac);
}

/** Basis points → display percent ("1500" → "15", "250" → "2.5"). */
function bpToPercent(rateBp: number): string {
  const whole = Math.floor(rateBp / 100);
  const frac = rateBp % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

const taxTypeEnum = z.enum(['standard', 'reduced', 'zero', 'exempt']);
const taxBasisEnum = z.enum(['exclusive', 'inclusive']);

const taxRateFormSchema = z.object({
  code: z.string().trim().min(1, 'required').max(20),
  name: z.string().trim().min(1, 'required').max(120),
  ratePct: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, 'ratePct')
    .refine((value) => percentToBp(value) <= 10000, 'ratePct'),
  type: taxTypeEnum,
  taxBasis: taxBasisEnum,
  coaAccountId: z.string().nullable(),
  isDefault: z.boolean(),
});

type TaxRateFormValues = z.infer<typeof taxRateFormSchema>;

/**
 * TaxRatesView — the org's VAT catalog (ACC-11). Rates carry a GL account
 * (where the tax posts — 2200 VAT receivable for purchases, 2100 VAT payable
 * for sales), an exclusive/inclusive basis, and an is-default flag the POS
 * uses as the fallback when a line carries no explicit rate. Creating a rate
 * is gated on `accounting:tax:manage`.
 */
export function TaxRatesView() {
  const t = useTranslations('modules.accounting');
  const global = useTranslations();
  const locale = useLocale();
  const { data: rates, isPending } = useAccountingTaxRates();
  const { data: coa } = useAccountingCoa();
  const { createTaxRate, updateTaxRate } = useAccountingMutations();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccountingTaxRate | null>(null);
  const [deactivating, setDeactivating] = useState<AccountingTaxRate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const accounts = coa?.items ?? [];

  const form = useForm<TaxRateFormValues>({
    resolver: zodResolver(taxRateFormSchema),
    defaultValues: {
      code: '',
      name: '',
      ratePct: '0',
      type: 'standard',
      taxBasis: 'exclusive',
      coaAccountId: '',
      isDefault: false,
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({
      code: '',
      name: '',
      ratePct: '0',
      type: 'standard',
      taxBasis: 'exclusive',
      coaAccountId: '',
      isDefault: false,
    });
    setFormOpen(true);
    setError(null);
    setSuccess(null);
  };

  const openEdit = (rate: AccountingTaxRate) => {
    setEditing(rate);
    form.reset({
      code: rate.code,
      name: rate.nameI18n.en ?? '',
      ratePct: bpToPercent(rate.rateBp),
      type: rate.type,
      taxBasis: rate.taxBasis,
      coaAccountId: rate.coaAccountId ?? '',
      isDefault: rate.isDefault,
    });
    setFormOpen(true);
    setError(null);
    setSuccess(null);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const onSubmit = async (values: TaxRateFormValues) => {
    setError(null);
    setSuccess(null);
    try {
      const nameI18n = { en: values.name };
      if (editing) {
        await updateTaxRate.mutateAsync({
          taxRateId: editing.id,
          patch: {
            ...(values.name !== (editing.nameI18n.en ?? '') ? { nameI18n } : {}),
            ...(percentToBp(values.ratePct) !== editing.rateBp ? { rateBp: percentToBp(values.ratePct) } : {}),
            ...(values.type !== editing.type ? { type: values.type } : {}),
            ...(values.taxBasis !== editing.taxBasis ? { taxBasis: values.taxBasis } : {}),
            ...(values.coaAccountId !== (editing.coaAccountId ?? '')
              ? { coaAccountId: values.coaAccountId === '' ? null : values.coaAccountId }
              : {}),
            ...(values.isDefault !== editing.isDefault ? { isDefault: values.isDefault } : {}),
          },
        });
        setSuccess(t('taxRates.editedMessage'));
      } else {
        await createTaxRate.mutateAsync({
          code: values.code,
          nameI18n,
          rateBp: percentToBp(values.ratePct),
          type: values.type,
          taxBasis: values.taxBasis,
          ...(values.coaAccountId !== '' ? { coaAccountId: values.coaAccountId } : {}),
          isDefault: values.isDefault,
        });
        setSuccess(t('taxRates.addedMessage', { code: values.code }));
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(accountingErrorKey(code ?? ''));
    }
  };

  const toggleActive = async (rate: AccountingTaxRate) => {
    setError(null);
    setSuccess(null);
    try {
      await updateTaxRate.mutateAsync({ taxRateId: rate.id, patch: { isActive: !rate.isActive } });
      setSuccess(rate.isActive ? t('taxRates.deactivatedMessage') : t('taxRates.activatedMessage'));
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(accountingErrorKey(code ?? ''));
    }
    setDeactivating(null);
  };

  const rateDisplayName = (rate: AccountingTaxRate) => rate.nameI18n[locale] ?? rate.nameI18n.en ?? rate.code;

  return (
    <div className="space-y-6">
      <AccountingPageHeader
        icon={Percent}
        title={t('taxRates.title')}
        subtitle={t('taxRates.subtitle')}
        actions={
          <Can permission="accounting:tax:manage">
            {formOpen ? (
              <Button variant="outline" onClick={closeForm}>
                {t('taxRates.hideForm')}
              </Button>
            ) : (
              <Button onClick={openCreate}>
                <Plus className="size-4" aria-hidden="true" />
                {t('taxRates.addRateAction')}
              </Button>
            )}
          </Can>
        }
      />

      {formOpen && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <h2 className="text-lg font-semibold">
              {editing ? t('taxRates.editTitle', { code: editing.code }) : t('taxRates.addRate')}
            </h2>
            <form
              onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="tr-code">{t('taxRates.fields.code')}</Label>
                <Input id="tr-code" {...form.register('code')} disabled={Boolean(editing)} />
                {form.formState.errors.code && (
                  <p className="text-xs text-destructive">{t('taxRates.fields.codeRequired')}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-name">{t('taxRates.fields.name')}</Label>
                <Input id="tr-name" {...form.register('name')} />
                {form.formState.errors.name && (
                  <p className="text-xs text-destructive">{t('taxRates.fields.nameRequired')}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-rate">{t('taxRates.fields.ratePct')}</Label>
                <Input id="tr-rate" inputMode="decimal" placeholder="15" {...form.register('ratePct')} />
                <p className="text-xs text-muted-foreground">{t('taxRates.fields.rateHint')}</p>
                {form.formState.errors.ratePct && (
                  <p className="text-xs text-destructive">{t('taxRates.errorRateInvalid')}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-type">{t('taxRates.fields.type')}</Label>
                <Select
                  id="tr-type"
                  value={form.watch('type')}
                  onValueChange={(value) => form.setValue('type', taxTypeEnum.parse(value))}
                >
                  {taxTypeEnum.options.map((key) => (
                    <SelectItem key={key} value={key}>
                      {t(`taxRates.types.${key}`)}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-basis">{t('taxRates.fields.basis')}</Label>
                <Select
                  id="tr-basis"
                  value={form.watch('taxBasis')}
                  onValueChange={(value) => form.setValue('taxBasis', taxBasisEnum.parse(value))}
                >
                  <SelectItem value="exclusive">{t('taxRates.basis.exclusive')}</SelectItem>
                  <SelectItem value="inclusive">{t('taxRates.basis.inclusive')}</SelectItem>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-coa">{t('taxRates.fields.glAccount')}</Label>
                <Select
                  id="tr-coa"
                  value={form.watch('coaAccountId') ?? ''}
                  onValueChange={(value) => form.setValue('coaAccountId', value)}
                >
                  <SelectItem value="">{t('taxRates.fields.glAccountNone')}</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.code} · {accountDisplayName(account, locale, t)}
                    </SelectItem>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">{t('taxRates.fields.glAccountHint')}</p>
              </div>
              <label className="flex items-start gap-3 rounded-md border p-3 sm:col-span-2 lg:col-span-1">
                <input
                  id="tr-default"
                  type="checkbox"
                  checked={form.watch('isDefault')}
                  onChange={(e) => form.setValue('isDefault', e.target.checked)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">{t('taxRates.fields.isDefault')}</span>
                  <span className="block text-xs text-muted-foreground">{t('taxRates.fields.isDefaultHint')}</span>
                </span>
              </label>
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
                <Button type="submit" loading={createTaxRate.isPending || updateTaxRate.isPending}>
                  {editing ? t('taxRates.submitUpdate') : t('taxRates.submitCreate')}
                </Button>
                <Button type="button" variant="outline" onClick={closeForm}>
                  {t('taxRates.hideForm')}
                </Button>
              </div>
              {error && (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2 lg:col-span-3"
                >
                  {t(error)}
                </p>
              )}
              {success && (
                <p
                  role="status"
                  className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 sm:col-span-2 lg:col-span-3"
                >
                  {success}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {isPending ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (rates?.items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('taxRates.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-muted-foreground">
                    <th className="py-2 text-start font-medium">{t('taxRates.tableCode')}</th>
                    <th className="py-2 text-start font-medium">{t('taxRates.tableName')}</th>
                    <th className="py-2 text-start font-medium">{t('taxRates.tableRate')}</th>
                    <th className="py-2 text-start font-medium">{t('taxRates.tableType')}</th>
                    <th className="py-2 text-start font-medium">{t('taxRates.tableBasis')}</th>
                    <th className="py-2 text-start font-medium">{t('taxRates.tableGlAccount')}</th>
                    <th className="py-2 text-start font-medium">{t('taxRates.tableDefault')}</th>
                    <th className="py-2 text-start font-medium">{t('taxRates.tableStatus')}</th>
                    <th className="py-2 text-start font-medium">{t('taxRates.tableActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(rates?.items ?? []).map((rate) => (
                    <tr key={rate.id} className="border-b">
                      <td className="py-2 font-medium">{rate.code}</td>
                      <td className="py-2">{rateDisplayName(rate)}</td>
                      <td className="py-2">{bpToPercent(rate.rateBp)}%</td>
                      <td className="py-2">{t(`taxRates.types.${rate.type}`)}</td>
                      <td className="py-2">{t(`taxRates.basis.${rate.taxBasis}`)}</td>
                      <td className="py-2">
                        {rate.coaAccountId
                          ? `${rate.coaAccountCode ?? ''}${rate.coaAccountCode ? ' · ' : ''}${rate.coaAccountNameI18n ? accountDisplayName({ nameI18n: rate.coaAccountNameI18n }, locale, t) : ''}`
                          : t('taxRates.fields.glAccountNone')}
                      </td>
                      <td className="py-2">{rate.isDefault && <Badge>{t('taxRates.default')}</Badge>}</td>
                      <td className="py-2">
                        <Badge variant={rate.isActive ? 'default' : 'secondary'}>
                          {rate.isActive ? t('taxRates.active') : t('taxRates.inactive')}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <div className="flex gap-2">
                          <Can permission="accounting:tax:manage">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(rate)}>
                              <Pencil className="size-4" aria-hidden="true" />
                              {t('taxRates.edit')}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setDeactivating(rate)}>
                              {rate.isActive ? t('taxRates.deactivate') : t('taxRates.activate')}
                            </Button>
                          </Can>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(deactivating)}
        title={deactivating?.isActive ? t('taxRates.deactivateTitle') : t('taxRates.activateTitle')}
        description={
          deactivating
            ? deactivating.isActive
              ? t('taxRates.deactivateBody', { name: rateDisplayName(deactivating) })
              : t('taxRates.activateBody', { name: rateDisplayName(deactivating) })
            : undefined
        }
        confirmLabel={deactivating?.isActive ? t('taxRates.deactivate') : t('taxRates.activate')}
        cancelLabel={global('common.cancel')}
        closeLabel={global('common.cancel')}
        onConfirm={() => deactivating && void toggleActive(deactivating)}
        onCancel={() => setDeactivating(null)}
      />
    </div>
  );
}
