'use client';

import { ArrowLeft, Building2 } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ModuleGate } from '@/lib/entitlements';

import { useCurrencies, useOrgBaseCurrency, usePurchasingSupplier } from './hooks';
import { formatMinorAmount, formatSignedMinor } from './labels';
import { PurchasingPageHeader } from './page-header';

/**
 * SupplierDetailView — one supplier with its append-only AP ledger (PUR-2):
 * every bill (+), payment (−) and debit note (−) that composes the balance.
 */
export function SupplierDetailView({ supplierId }: { supplierId: string }) {
  const t = useTranslations('modules.purchasing');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const { data, isPending } = usePurchasingSupplier(supplierId);

  const supplier = data?.supplier;
  const currency = supplier?.currency ?? baseCurrency;
  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, currency, { locale, exponent });

  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5">
        <PurchasingPageHeader
          icon={Building2}
          title={supplier?.name ?? t('suppliers.detailTitle')}
          subtitle={`${supplier?.code ?? ''} · ${t('suppliers.balance')}: ${
            data ? formatMinor(data.balanceMinor) : '—'
          }`}
          actions={
            <Button asChild variant="outline">
              <Link href="/m/purchasing/suppliers">
                <ArrowLeft />
                {t('common.back')}
              </Link>
            </Button>
          }
        />

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>{t('suppliers.contactTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('suppliers.taxId')}</span>
                <span>{supplier?.taxId ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('suppliers.contactName')}</span>
                <span>{supplier?.contactName ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('suppliers.contactEmail')}</span>
                <span>{supplier?.contactEmail ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('suppliers.contactPhone')}</span>
                <span>{supplier?.contactPhone ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('suppliers.netDays')}</span>
                <span>{supplier?.paymentTerms.netDays ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('suppliers.currency')}</span>
                <span>{supplier?.currency ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('suppliers.status')}</span>
                <Badge variant={supplier?.isActive ? 'default' : 'secondary'}>
                  {supplier?.isActive ? t('suppliers.active') : t('suppliers.inactive')}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t('suppliers.ledgerTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isPending ? (
                <p className="py-8 text-center text-muted-foreground">{t('common.loading')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start text-muted-foreground">
                        <th className="py-2 pe-4 text-start font-medium">{t('suppliers.ledgerDate')}</th>
                        <th className="py-2 pe-4 text-start font-medium">{t('suppliers.ledgerType')}</th>
                        <th className="py-2 pe-4 text-start font-medium">{t('suppliers.ledgerReference')}</th>
                        <th className="py-2 text-end font-medium">{t('suppliers.ledgerAmount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.ledger ?? []).map((entry) => (
                        <tr key={entry.id} className="border-b">
                          <td className="py-2 pe-4">{entry.entryDate}</td>
                          <td className="py-2 pe-4">{t(`suppliers.ledgerTypes.${entry.type}`)}</td>
                          <td className="py-2 pe-4">{entry.referenceNumber ?? '—'}</td>
                          <td className="py-2 text-end">
                            {formatSignedMinor(entry.amountMinor, entry.currency, locale, exponent)}
                          </td>
                        </tr>
                      ))}
                      {(data?.ledger ?? []).length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-muted-foreground">
                            {t('suppliers.ledgerEmpty')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </ModuleGate>
  );
}
