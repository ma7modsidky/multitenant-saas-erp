'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { getAdminModules, updateAdminModulePricing, type AdminModulePricingRow } from '@/lib/api/resources';
import { resolveEnModuleLabel } from '@/lib/module-labels';

const CURRENCY_EXPONENTS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  SAR: 2,
  AED: 2,
  EGP: 2,
  JPY: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  TND: 3,
};

const CURRENCIES = Object.keys(CURRENCY_EXPONENTS);

function exponentOf(currency: string): number {
  return CURRENCY_EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** minor units → major-units string for the editable input. */
function toMajor(amountMinor: string, currency: string): string {
  const minor = Number(amountMinor ?? 0);
  if (!Number.isFinite(minor) || minor <= 0) return '';
  return (minor / 10 ** exponentOf(currency)).toFixed(exponentOf(currency));
}

/** major-units input → minor units string (rounded at the boundary, CUR-7). */
function toMinor(major: string, currency: string): string {
  const value = Number(major);
  if (!Number.isFinite(value) || value < 0) return '';
  return String(Math.round(value * 10 ** exponentOf(currency)));
}

interface EditableRow {
  monthly: string;
  yearly: string;
  currency: string;
}

export default function AdminModulesPage() {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-modules'], queryFn: getAdminModules });

  const [edits, setEdits] = useState<Record<string, EditableRow>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // Initialize the editable rows from the fetched data once.
  useEffect(() => {
    if (!data) return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const row of data) {
        if (!next[row.moduleKey]) {
          next[row.moduleKey] = {
            monthly: toMajor(row.priceMonthlyMinor, row.currency),
            yearly: toMajor(row.priceYearlyMinor, row.currency),
            currency: row.currency,
          };
        }
      }
      return next;
    });
  }, [data]);

  const rowOf = (mod: AdminModulePricingRow): EditableRow =>
    edits[mod.moduleKey] ?? {
      monthly: toMajor(mod.priceMonthlyMinor, mod.currency),
      yearly: toMajor(mod.priceYearlyMinor, mod.currency),
      currency: mod.currency,
    };

  const setRow = (moduleKey: string, patch: Partial<EditableRow>) =>
    setEdits((prev) => ({
      ...prev,
      [moduleKey]: { ...(prev[moduleKey] ?? { monthly: '', yearly: '', currency: 'USD' }), ...patch },
    }));

  const formatMoney = (amountMinor: string, currency: string) => {
    const minor = Number(amountMinor ?? 0);
    if (minor <= 0) return '—';
    const exp = exponentOf(currency);
    const amount = minor / 10 ** exp;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(amount);
  };

  const save = async (mod: AdminModulePricingRow) => {
    const row = rowOf(mod);
    const monthlyMinor = toMinor(row.monthly, row.currency);
    const yearlyMinor = toMinor(row.yearly, row.currency);
    if (monthlyMinor === '' || yearlyMinor === '') {
      setMessage({ type: 'error', text: t('admin.pricing.invalidAmount') });
      return;
    }
    setBusyKey(mod.moduleKey);
    setMessage(null);
    try {
      await updateAdminModulePricing(mod.moduleKey, {
        priceMonthlyMinor: monthlyMinor,
        priceYearlyMinor: yearlyMinor,
        currency: row.currency,
      });
      setMessage({ type: 'success', text: t('admin.pricing.saved') });
      await queryClient.invalidateQueries({ queryKey: ['admin-modules'] });
    } catch (err) {
      setMessage({
        type: 'error',
        text:
          err instanceof ApiError && err.code === 'NETWORK_ERROR'
            ? t('auth.errors.network')
            : t('admin.pricing.saveFailed'),
      });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('admin.pricing.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.pricing.subtitle')}</p>
      </div>

      {message && (
        <p
          role="status"
          className={
            message.type === 'error'
              ? 'rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive'
              : 'rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400'
          }
        >
          {message.text}
        </p>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('admin.pricing.empty')}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(data ?? []).map((mod) => {
            const row = rowOf(mod);
            // The catalog stores i18n name keys; the admin console is
            // English-only, so labels are resolved from the en catalog.
            const moduleName = resolveEnModuleLabel(mod.name);
            const dependsOn = mod.dependsOn.length > 0 ? mod.dependsOn.join(', ') : '—';
            return (
              <Card key={mod.moduleKey}>
                <CardContent className="space-y-4 p-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold">{moduleName}</h2>
                      <Badge variant="secondary">{mod.moduleKey}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('admin.pricing.tableRequires')} {dependsOn}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t('admin.pricing.tableMonthly')}{' '}
                      <span className="font-medium text-foreground">
                        {formatMoney(mod.priceMonthlyMinor, mod.currency)}
                      </span>
                      {' · '}
                      {t('admin.pricing.tableYearly')}{' '}
                      <span className="font-medium text-foreground">
                        {formatMoney(mod.priceYearlyMinor, mod.currency)}
                      </span>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        className="mb-1 block text-xs font-medium text-muted-foreground"
                        htmlFor={`${mod.moduleKey}-monthly`}
                      >
                        {t('admin.pricing.tableMonthly')}
                      </label>
                      <Input
                        id={`${mod.moduleKey}-monthly`}
                        inputMode="decimal"
                        value={row.monthly}
                        onChange={(e) => setRow(mod.moduleKey, { monthly: e.target.value })}
                        aria-label={`${moduleName} ${t('admin.pricing.tableMonthly')}`}
                      />
                    </div>
                    <div>
                      <label
                        className="mb-1 block text-xs font-medium text-muted-foreground"
                        htmlFor={`${mod.moduleKey}-yearly`}
                      >
                        {t('admin.pricing.tableYearly')}
                      </label>
                      <Input
                        id={`${mod.moduleKey}-yearly`}
                        inputMode="decimal"
                        value={row.yearly}
                        onChange={(e) => setRow(mod.moduleKey, { yearly: e.target.value })}
                        aria-label={`${moduleName} ${t('admin.pricing.tableYearly')}`}
                      />
                    </div>
                    <div>
                      <label
                        className="mb-1 block text-xs font-medium text-muted-foreground"
                        htmlFor={`${mod.moduleKey}-currency`}
                      >
                        {t('admin.pricing.tableCurrency')}
                      </label>
                      <select
                        id={`${mod.moduleKey}-currency`}
                        value={row.currency}
                        onChange={(e) => setRow(mod.moduleKey, { currency: e.target.value })}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`${moduleName} ${t('admin.pricing.tableCurrency')}`}
                      >
                        {CURRENCIES.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <Button className="w-full" disabled={busyKey === mod.moduleKey} onClick={() => void save(mod)}>
                        {t('admin.pricing.save')}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
