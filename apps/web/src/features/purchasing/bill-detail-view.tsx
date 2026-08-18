'use client';

import { ArrowLeft, Banknote, CheckCircle2, Receipt } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';

import type { PurchasingBillDetail } from '@/lib/api/resources';

import { usePurchasingError } from './errors';
import { useCurrencies, useOrgBaseCurrency, usePurchasingBill, usePurchasingMutations } from './hooks';
import { formatMinorAmount, formatQuantity, statusTone } from './labels';
import { PurchasingPageHeader } from './page-header';

// A readonly typed array avoids an `as const` cast (no-restricted-syntax).
const PAYMENT_METHODS: readonly string[] = ['cash', 'bank_transfer', 'card', 'cheque', 'other'];

/**
 * BillDetailView — one purchase bill (PUR-6): supplier snapshot, itemized
 * lines with per-line tax, and the approve / record-payment actions. Bills are
 * append-only once approved — corrections are credit notes (PUR-11).
 */
export function BillDetailView({ billId }: { billId: string }) {
  const t = useTranslations('modules.purchasing');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const { data, isPending } = usePurchasingBill(billId);
  const { approveBill, recordPayment } = usePurchasingMutations();
  const errorKey = usePurchasingError();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');

  const bill: PurchasingBillDetail | undefined = data;
  const currency = bill?.currency ?? baseCurrency;
  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, currency, { locale, exponent });
  const balanceDue = bill ? BigInt(bill.totalMinor) - BigInt(bill.paidMinor) : 0n;
  const canPay = bill && (bill.status === 'approved' || bill.status === 'partially_paid') && balanceDue > 0n;

  const onApprove = async () => {
    setError(null);
    setSuccess(null);
    try {
      await approveBill.mutateAsync({ id: billId });
      setSuccess(t('bills.approvedMessage'));
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : undefined));
    }
  };

  const onPay = async () => {
    if (!bill) return;
    setError(null);
    setSuccess(null);
    try {
      await recordPayment.mutateAsync({
        supplierId: bill.supplierId,
        method: paymentMethod,
        amountMinor: paymentAmount,
        currency,
        allocations: [{ billId: bill.id, amountMinor: paymentAmount }],
      });
      setSuccess(t('bills.paidMessage'));
      setPayOpen(false);
      setPaymentAmount('');
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : undefined));
    }
  };

  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5">
        <PurchasingPageHeader
          icon={Receipt}
          title={bill?.number ?? t('bills.detailTitle')}
          subtitle={bill ? `${bill.supplierNameSnapshot} · ${t(`bills.statuses.${bill.status}`)}` : ''}
          actions={
            <>
              {bill?.status === 'draft' && (
                <Button onClick={() => void onApprove()} disabled={approveBill.isPending}>
                  <CheckCircle2 />
                  {t('bills.approve')}
                </Button>
              )}
              {canPay && (
                <Button onClick={() => setPayOpen(true)}>
                  <Banknote />
                  {t('bills.pay')}
                </Button>
              )}
              <Button asChild variant="outline">
                <Link href="/m/purchasing/bills">
                  <ArrowLeft />
                  {t('common.back')}
                </Link>
              </Button>
            </>
          }
        />

        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-emerald-600">{success}</p>}

        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>{t('bills.summaryTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('bills.status')}</span>
                {bill && <Badge variant={statusTone(bill.status)}>{t(`bills.statuses.${bill.status}`)}</Badge>}
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('bills.billDate')}</span>
                <span>{bill?.billDate ? new Date(bill.billDate).toLocaleDateString(locale) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('bills.dueDate')}</span>
                <span>{bill?.dueDate ? new Date(bill.dueDate).toLocaleDateString(locale) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('bills.supplierTaxId')}</span>
                <span>{bill?.supplierTaxIdSnapshot ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('bills.referencePo')}</span>
                <span>
                  {bill?.poId ? (
                    <Link className="text-primary hover:underline" href={`/m/purchasing/purchase-orders/${bill.poId}`}>
                      {bill.poId.slice(0, 8)}
                    </Link>
                  ) : (
                    '—'
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('bills.subtotal')}</span>
                <span>{bill ? formatMinor(bill.subtotalMinor) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('bills.tax')}</span>
                <span>{bill ? formatMinor(bill.taxMinor) : '—'}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-medium">
                <span>{t('bills.total')}</span>
                <span>{bill ? formatMinor(bill.totalMinor) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('bills.paid')}</span>
                <span>{bill ? formatMinor(bill.paidMinor) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('bills.balanceDue')}</span>
                <span>{bill ? formatMinor(balanceDue.toString()) : '—'}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t('bills.lines')}</CardTitle>
            </CardHeader>
            <CardContent>
              {isPending ? (
                <p className="py-8 text-center text-muted-foreground">{t('common.loading')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start text-muted-foreground">
                        <th className="py-2 pe-4 text-start font-medium">{t('bills.itemName')}</th>
                        <th className="py-2 pe-4 text-end font-medium">{t('bills.quantity')}</th>
                        <th className="py-2 pe-4 text-end font-medium">{t('bills.unitCost')}</th>
                        <th className="py-2 pe-4 text-end font-medium">{t('bills.tax')}</th>
                        <th className="py-2 text-end font-medium">{t('bills.lineTotal')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(bill?.lines ?? []).map((line) => (
                        <tr key={line.id} className="border-b">
                          <td className="py-2 pe-4">{line.itemNameSnapshot || '—'}</td>
                          <td className="py-2 pe-4 text-end">{formatQuantity(line.quantity)}</td>
                          <td className="py-2 pe-4 text-end">{formatMinor(line.unitCostMinor)}</td>
                          <td className="py-2 pe-4 text-end">{formatMinor(line.taxMinor)}</td>
                          <td className="py-2 text-end">{formatMinor(line.lineTotalMinor)}</td>
                        </tr>
                      ))}
                      {(bill?.lines ?? []).length === 0 && (
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
            </CardContent>
          </Card>
        </div>
      </div>

      {payOpen && bill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>{t('bills.payTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="bill-pay-amount">{t('bills.payAmount')}</Label>
                <Input
                  id="bill-pay-amount"
                  type="number"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  placeholder={balanceDue.toString()}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bill-pay-method">{t('bills.payMethod')}</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {t(`payments.methods.${method}`)}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPayOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={() => void onPay()} disabled={!paymentAmount || recordPayment.isPending}>
                  {t('bills.pay')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </ModuleGate>
  );
}
