'use client';

import { BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Card, CardContent } from '@/components/ui/card';
import { ModuleGate } from '@/lib/entitlements';

import type { PurchasingVendorBalance } from '@/lib/api/resources';

import { useCurrencies, useOrgBaseCurrency, usePurchasingVendorBalances } from './hooks';
import { formatMinorAmount } from './labels';
import { PurchasingPageHeader } from './page-header';

/**
 * VendorBalancesView — the derived AP ledger (PUR-2): every supplier with its
 * signed balance (bills +, payments −, debit notes −). Balances are always
 * derived from the append-only vendor ledger — never a stored, editable number.
 */
export function VendorBalancesView() {
  const t = useTranslations('modules.purchasing');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const { data, isPending } = usePurchasingVendorBalances();

  const suppliers: PurchasingVendorBalance[] = data?.suppliers ?? [];
  const formatMinor = (amountMinor: string, currency = baseCurrency) =>
    formatMinorAmount(amountMinor, currency, { locale, exponent });
  const totalMinor = data?.totalBalanceMinor ?? '0';

  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5">
        <PurchasingPageHeader
          icon={BarChart3}
          title={t('vendorBalances.title')}
          subtitle={t('vendorBalances.subtitle')}
        />

        <Card>
          <CardContent className="pt-4">
            {isPending ? (
              <p className="py-8 text-center text-muted-foreground">{t('common.loading')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-start text-muted-foreground">
                      <th className="py-2 pe-4 text-start font-medium">{t('vendorBalances.supplier')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('vendorBalances.code')}</th>
                      <th className="py-2 text-end font-medium">{t('vendorBalances.balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((supplier) => (
                      <tr key={supplier.id} className="border-b">
                        <td className="py-2 pe-4">
                          <Link
                            href={`/m/purchasing/suppliers/${supplier.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {supplier.name}
                          </Link>
                        </td>
                        <td className="py-2 pe-4">{supplier.code}</td>
                        <td className="py-2 text-end">{formatMinor(supplier.balanceMinor, supplier.currency)}</td>
                      </tr>
                    ))}
                    {suppliers.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-muted-foreground">
                          {t('vendorBalances.empty')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {suppliers.length > 0 && (
                    <tfoot>
                      <tr className="border-t font-medium">
                        <td colSpan={3} className="py-2 pe-4 text-end">
                          {t('vendorBalances.total')}
                        </td>
                        <td className="py-2 text-end">{formatMinor(totalMinor)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ModuleGate>
  );
}
