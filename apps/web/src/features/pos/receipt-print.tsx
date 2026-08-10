'use client';

import { Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import type { PosSale } from '@/lib/api/resources';

import { useActiveOrganization, useCurrencies, usePosContact, usePosSale } from './hooks';
import { localizedLabel } from './labels';
import { formatMinorAmount } from './money';

interface ReceiptPrintProps {
  saleId: string;
  /** Preloaded sale — avoids a refetch when the caller already has it. */
  sale?: PosSale;
  /** Register display name for the receipt header. */
  registerName?: string;
  /** Button style — outline (default) or link (compact contexts like checkout). */
  variant?: 'outline' | 'link';
  /** Compact button size for dense contexts. */
  compact?: boolean;
}

/**
 * POS receipt printing (POS-9 receipts). Renders a "Print receipt" button and
 * a hidden printable receipt (`#pos-receipt`); globals.css hides every other
 * element in the print media so only the receipt is printed.
 *
 * The receipt regenerates from the sale's own `locale` snapshot (POS-19), so
 * the printed document matches the register language regardless of the
 * operator's current UI locale.
 */
export function ReceiptPrint({
  saleId,
  sale: preloaded,
  registerName,
  variant = 'outline',
  compact,
}: ReceiptPrintProps) {
  const t = useTranslations('modules.pos');
  const { data: fetched } = usePosSale(saleId, Boolean(saleId) && !preloaded);
  const sale = preloaded ?? fetched;
  const { data: org } = useActiveOrganization();
  const { data: currencies } = useCurrencies();
  const { data: customer } = usePosContact(sale?.customerContactId ?? null, Boolean(sale?.customerContactId));

  const locale = sale?.locale ?? 'en';
  const currency = sale?.currency ?? 'USD';
  const exponent = currencies?.find((c) => c.code === currency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, currency, { locale, exponent });
  const hasDiscount = sale !== undefined && BigInt(sale.discount.amountMinor) !== 0n;

  return (
    <>
      <Button
        variant={variant}
        size={compact ? 'sm' : 'default'}
        {...(variant === 'link' ? { className: 'h-auto p-0' } : {})}
        disabled={!sale}
        onClick={() => window.print()}
        aria-label={t('sale.printReceipt')}
      >
        <Printer className="size-4" aria-hidden="true" />
        <span className="ms-1">{t('sale.printReceipt')}</span>
      </Button>

      {/* Hidden on screen — visible only in print (see globals.css). */}
      {sale && (
        <div id="pos-receipt" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          <div className="text-center">
            {org?.data.name && <p className="text-base font-bold">{org.data.name}</p>}
            <p className="text-sm font-semibold">{t('checkout.receiptNumber', { number: sale.receiptNumber })}</p>
            <p className="text-xs text-muted-foreground">{t(`reports.status.${sale.status}`)}</p>
          </div>

          <div className="mt-2 space-y-0.5 text-xs">
            <p>
              {t('sale.register')}: {registerName ?? sale.registerId}
            </p>
            <p>
              {t('sale.soldAt')}: {new Date(sale.soldAt).toLocaleString(locale)}
            </p>
          </div>

          <hr className="my-2 border-dashed" />

          <table className="w-full text-xs">
            <tbody>
              {sale.lines.map((line) => (
                <tr key={line.id} className="align-top">
                  <td className="py-0.5">
                    <p className="font-medium" dir="auto">
                      {localizedLabel(line.nameSnapshot, locale)}
                    </p>
                    <p className="text-muted-foreground">{line.skuSnapshot}</p>
                    <p className="text-muted-foreground">
                      {line.quantity} × {formatMinor(line.unitPriceAmountMinor)}
                    </p>
                  </td>
                  <td className="whitespace-nowrap py-0.5 text-end font-mono tabular-nums">
                    {formatMinor(line.lineTotalAmountMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <hr className="my-2 border-dashed" />

          <div className="space-y-0.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('sale.subtotal')}</span>
              <span className="font-mono tabular-nums">{formatMinor(sale.subtotal.amountMinor)}</span>
            </div>
            {hasDiscount && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('sale.discount')}</span>
                <span className="font-mono tabular-nums">−{formatMinor(sale.discount.amountMinor)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('sale.tax')}</span>
              <span className="font-mono tabular-nums">{formatMinor(sale.tax.amountMinor)}</span>
            </div>
            <div className="flex justify-between border-t pt-1 text-sm font-bold">
              <span>{t('sale.total')}</span>
              <span className="font-mono tabular-nums">{formatMinor(sale.total.amountMinor)}</span>
            </div>
          </div>

          <hr className="my-2 border-dashed" />

          <div className="space-y-0.5 text-xs">
            {sale.payments.map((payment) => (
              <div key={payment.id} className="flex justify-between">
                <span>{t(`sale.method.${payment.method}`)}</span>
                <span className="font-mono tabular-nums">
                  {formatMinor(payment.amountMinor)}
                  {payment.method === 'cash' && payment.tenderedAmountMinor !== null && (
                    <span className="text-muted-foreground">
                      {' '}
                      ({t('sale.tableTendered')}: {formatMinor(payment.tenderedAmountMinor)}
                      {BigInt(payment.changeAmountMinor) !== 0n
                        ? ` · ${t('sale.tableChange')}: ${formatMinor(payment.changeAmountMinor)}`
                        : ''}
                      )
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {customer && (
            <p className="mt-2 text-xs">
              {t('sale.customer')}: {customer.firstName} {customer.lastName}
            </p>
          )}
        </div>
      )}
    </>
  );
}
