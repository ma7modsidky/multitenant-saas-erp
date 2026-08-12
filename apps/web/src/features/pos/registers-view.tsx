'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus, ShoppingCart, X } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { getInventoryWarehouses } from '@/lib/api/resources';
import { ModuleGate } from '@/lib/entitlements';
import { Can } from '@/lib/permissions';

import { posErrorKey } from './errors';
import { CloseShiftForm, OpenShiftForm, RegisterForm } from './forms';
import { useCurrencies, useOrgBaseCurrency, usePosMutations, usePosRegisters } from './hooks';
import { formatMinorAmount, subtractMinorAmounts } from './money';
import type { CloseShiftFormValues, OpenShiftFormValues, RegisterFormValues } from './schemas';

export function RegistersView() {
  const t = useTranslations('modules.pos');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, baseCurrency, { locale, exponent });

  const { data: registers, isPending } = usePosRegisters();
  const { data: warehouses } = useQuery({
    queryKey: ['inventory', 'warehouses'],
    queryFn: getInventoryWarehouses,
  });
  const { createRegister, openShift, closeShift } = usePosMutations();

  // Which form is open and which register it targets (row preselect).
  const [section, setSection] = useState<'create' | 'open' | 'close' | null>(null);
  const [targetRegisterId, setTargetRegisterId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const warehouseOptions = (warehouses?.items ?? []).map((w) => ({ id: w.id, name: w.name, code: w.code }));

  const openForm = (next: 'create' | 'open' | 'close' | null, registerId?: string) => {
    setTargetRegisterId(registerId ?? null);
    setSection(next);
    setError(null);
    setSuccess(null);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const handleCreate = async (values: RegisterFormValues) => {
    setError(null);
    try {
      await createRegister.mutateAsync(values);
      setSuccess(t('register.createdMessage'));
      setSection(null);
    } catch (err) {
      setError(err instanceof ApiError ? posErrorKey(err.code) : 'errors.unknown');
    }
  };

  const handleOpen = async (values: OpenShiftFormValues) => {
    if (!targetRegisterId) return;
    setError(null);
    try {
      await openShift.mutateAsync({ registerId: targetRegisterId, ...values });
      setSuccess(t('register.openMessage'));
      setSection(null);
      setTargetRegisterId(null);
    } catch (err) {
      setError(err instanceof ApiError ? posErrorKey(err.code) : 'errors.unknown');
    }
  };

  const handleClose = async (values: CloseShiftFormValues) => {
    if (!targetRegisterId) return;
    setError(null);
    try {
      const result = await closeShift.mutateAsync({ registerId: targetRegisterId, ...values });
      const variance = subtractMinorAmounts(result.varianceAmountMinor, '0');
      const sign = BigInt(result.varianceAmountMinor) >= 0n ? '+' : '';
      setSuccess(
        `${t('register.closedMessage')} ${t('register.closeResult', {
          expected: formatMinor(result.expectedCashAmountMinor),
          variance: `${sign}${formatMinor(variance)}`,
        })}`,
      );
      setSection(null);
      setTargetRegisterId(null);
    } catch (err) {
      setError(err instanceof ApiError ? posErrorKey(err.code) : 'errors.unknown');
    }
  };

  const targetRegister = registers?.items.find((r) => r.id === targetRegisterId) ?? null;

  return (
    <ModuleGate moduleKey="pos">
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('register.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('register.subtitle')}</p>
          </div>
          <Can permission="pos:register:manage">
            <Button variant="outline" onClick={() => openForm(section === 'create' ? null : 'create')}>
              {section === 'create' ? <X /> : <Plus />}
              <span className="ms-1">{t('register.create')}</span>
            </Button>
          </Can>
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t(error)}
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

        <div ref={formRef}>
          {section === 'create' && (
            <RegisterForm warehouses={warehouseOptions} onSubmit={handleCreate} pending={createRegister.isPending} />
          )}
          {section === 'open' && (
            <OpenShiftForm
              key={`open-${targetRegisterId ?? 'none'}`}
              registerLabel={targetRegister ? `${targetRegister.name} (${targetRegister.code})` : null}
              onSubmit={handleOpen}
              pending={openShift.isPending}
            />
          )}
          {section === 'close' && (
            <CloseShiftForm
              key={`close-${targetRegisterId ?? 'none'}`}
              registerLabel={targetRegister ? `${targetRegister.name} (${targetRegister.code})` : null}
              onSubmit={handleClose}
              pending={closeShift.isPending}
            />
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('register.tableName')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('register.tableCode')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('register.tableWarehouse')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('register.tableStatus')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('register.tableActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isPending && !registers ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        {t('common.loading')}
                      </td>
                    </tr>
                  ) : (registers?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        {t('register.empty')}
                      </td>
                    </tr>
                  ) : (
                    registers?.items.map((register) => {
                      const warehouse = warehouseOptions.find((w) => w.id === register.warehouseId);
                      const hasOpenShift = Boolean(register.openShiftId);
                      return (
                        <tr key={register.id} className="transition-colors hover:bg-accent/30">
                          <td className="px-4 py-3 font-medium" dir="auto">
                            {register.name}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{register.code}</td>
                          <td className="px-4 py-3 text-muted-foreground" dir="auto">
                            {warehouse?.name ?? '—'}
                          </td>
                          <td className="px-4 py-3">
                            {hasOpenShift ? (
                              <Badge variant="secondary">{t('register.statusOpen')}</Badge>
                            ) : (
                              <Badge variant="outline">{t('register.statusClosed')}</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <Can permission="pos:sale:create">
                                <Button asChild variant="ghost" size="sm">
                                  <Link href={`/${locale}/m/pos/checkout?registerId=${register.id}`}>
                                    <ShoppingCart className="size-4" aria-hidden="true" />
                                    <span className="ms-1">{t('register.newSale')}</span>
                                  </Link>
                                </Button>
                              </Can>
                              <Can permission="pos:shift:open">
                                {!hasOpenShift && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openForm('open', register.id)}
                                    aria-label={t('register.openFor', { register: register.name })}
                                  >
                                    {t('register.openShift')}
                                  </Button>
                                )}
                              </Can>
                              <Can permission="pos:shift:close">
                                {hasOpenShift && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openForm('close', register.id)}
                                    aria-label={t('register.closeFor', { register: register.name })}
                                  >
                                    {t('register.closeShift')}
                                  </Button>
                                )}
                              </Can>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ModuleGate>
  );
}
