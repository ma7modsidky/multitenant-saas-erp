'use client';

import { Minus, Plus, ShoppingCart, Trash2, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';
import { createCrmContact } from '@/lib/api/resources';

import { posErrorKey } from './errors';
import {
  useCurrencies,
  useOrgBaseCurrency,
  usePosCatalog,
  usePosContacts,
  usePosMutations,
  usePosRegisters,
} from './hooks';
import { localizedLabel } from './labels';
import {
  formatMinorAmount,
  lineTotalMinor,
  scaleQuantity,
  subtractMinorAmounts,
  sumMinorAmounts,
  unscaleQuantity,
} from './money';
import type { CartLineValues } from './schemas';

/** One sellable variant in the checkout picker (price + name snapshot). */
interface CatalogItem {
  variantId: string;
  productId: string;
  sku: string;
  nameI18n: Record<string, string>;
  unitPriceAmountMinor: string;
}

export function CheckoutView() {
  const t = useTranslations('modules.pos');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;

  const { data: registers, isPending: registersPending } = usePosRegisters();
  const { data: catalog } = usePosCatalog();
  const { data: contacts } = usePosContacts();
  const { checkout } = usePosMutations();

  // Inline "New customer" creation — creates the contact, then selects it for
  // the sale (POS-18). Errors stay KEYs (translated at render).
  const client = useQueryClient();
  const createCustomer = useMutation({
    mutationFn: createCrmContact,
    onSuccess: (contact) => {
      void client.invalidateQueries({ queryKey: ['pos', 'contacts'] });
      setCustomerContactId(contact.id);
      setNewCustomerOpen(false);
      setSuccess(null);
    },
  });

  // Cart state — the register (from the URL preselect), lines, and payment.
  const [registerId, setRegisterId] = useState(searchParams.get('registerId') ?? '');
  const [lines, setLines] = useState<CartLineValues[]>([]);
  const [method, setMethod] = useState<'cash' | 'card' | 'other'>('cash');
  const [tenderedAmountMinor, setTenderedAmountMinor] = useState('');
  const [pickerVariantId, setPickerVariantId] = useState('');
  const [customerContactId, setCustomerContactId] = useState('');
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [customerFirstName, setCustomerFirstName] = useState('');
  const [customerLastName, setCustomerLastName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerFormError, setCustomerFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ saleId: string; receiptNumber: string } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  // When the registers land, honor the URL preselect (a register id from the
  // "New sale" row action) and otherwise default to the first register.
  useEffect(() => {
    if (!registers) return;
    const fromUrl = searchParams.get('registerId');
    if (fromUrl && registers.items.some((r) => r.id === fromUrl)) {
      setRegisterId(fromUrl);
      return;
    }
    setRegisterId((current) => current || (registers.items[0]?.id ?? ''));
  }, [registers]);

  // Flatten the catalog to sellable variants. Only variants priced in the org
  // base currency are offered (POS-11: the sale is always in the register
  // currency = base currency); the picker hints the unit price.
  const sellable = useMemo<CatalogItem[]>(() => {
    if (!catalog) return [];
    const items: CatalogItem[] = [];
    for (const product of catalog.items) {
      if (!product.isActive) continue;
      for (const variant of product.variants) {
        if (!variant.isActive) continue;
        if (variant.price === null || variant.price.currency !== baseCurrency) continue;
        items.push({
          variantId: variant.id,
          productId: product.id,
          sku: variant.sku ?? '',
          nameI18n: product.nameI18n,
          unitPriceAmountMinor: variant.price.amountMinor,
        });
      }
    }
    return items.sort((a, b) => localizedLabel(a.nameI18n, locale).localeCompare(localizedLabel(b.nameI18n, locale)));
  }, [catalog, baseCurrency, locale]);

  const selectedRegister = registers?.items.find((r) => r.id === registerId) ?? null;
  const hasOpenShift = Boolean(selectedRegister?.openShiftId);

  const subtotalMinor = sumMinorAmounts(lines.map((line) => lineTotalMinor(line.unitPriceAmountMinor, line.quantity)));
  const totalMinor = subtotalMinor;
  const changeMinor = subtractMinorAmounts(tenderedAmountMinor || '0', totalMinor);

  const addLine = (variantId: string) => {
    const item = sellable.find((v) => v.variantId === variantId);
    if (!item) return;
    // Re-adding an existing variant bumps its quantity by one.
    setLines((current) => {
      const existing = current.find((l) => l.variantId === variantId);
      if (existing) {
        // Exact 4-decimal stepping (hard rule #3 — no float math on UoM).
        const nextQty = unscaleQuantity(scaleQuantity(existing.quantity) + 10_000n);
        return current.map((l) => (l.variantId === variantId ? { ...l, quantity: nextQty } : l));
      }
      return [
        ...current,
        {
          variantId: item.variantId,
          sku: item.sku,
          nameI18n: item.nameI18n,
          quantity: '1',
          unitPriceAmountMinor: item.unitPriceAmountMinor,
          currency: baseCurrency,
        },
      ];
    });
    setPickerVariantId('');
    setSuccess(null);
  };

  const updateQuantity = (variantId: string, quantity: string) => {
    setLines((current) => current.map((l) => (l.variantId === variantId ? { ...l, quantity } : l)));
  };

  const handleCheckout = async () => {
    setError(null);
    setSuccess(null);
    if (!registerId) {
      setError('checkout.noRegister');
      return;
    }
    if (lines.length === 0) {
      setError('checkout.emptyCart');
      return;
    }
    if (!hasOpenShift) {
      setError('checkout.noOpenShift');
      return;
    }
    if (method === 'cash') {
      const tendered = BigInt(tenderedAmountMinor || '0');
      if (tendered < BigInt(totalMinor)) {
        setError('checkout.insufficientTendered');
        return;
      }
    }
    try {
      const result = await checkout.mutateAsync({
        registerId,
        locale,
        lines: lines.map((line) => ({
          variantId: line.variantId,
          sku: line.sku,
          nameI18n: line.nameI18n,
          quantity: line.quantity,
          unitPrice: { amountMinor: line.unitPriceAmountMinor, currency: baseCurrency },
          taxRateBp: 0,
          currency: baseCurrency,
        })),
        payments:
          method === 'cash'
            ? [
                {
                  method,
                  amount: { amountMinor: totalMinor, currency: baseCurrency },
                  currency: baseCurrency,
                  tenderedAmountMinor,
                  changeAmountMinor: changeMinor,
                },
              ]
            : [{ method, amount: { amountMinor: totalMinor, currency: baseCurrency }, currency: baseCurrency }],
        // POS-26: a client-generated key makes retries idempotent — reuse the
        // same key for the cart so a failed request can be retried without
        // creating a duplicate sale, then rotate it after success.
        idempotencyKey,
        // POS-18: link the sale to an existing (or just-created) customer.
        ...(customerContactId ? { customerContactId } : {}),
      });
      setSuccess(result);
      setLines([]);
      setTenderedAmountMinor('');
      setCustomerContactId('');
      setIdempotencyKey(crypto.randomUUID());
    } catch (err) {
      setError(err instanceof ApiError ? posErrorKey(err.code) : 'errors.unknown');
    }
  };

  /** Create the inline new customer — CRM-1 requires email or phone too. */
  const handleCreateCustomer = () => {
    setCustomerFormError(null);
    if (!customerFirstName.trim() || !customerLastName.trim()) {
      setCustomerFormError('checkout.customerNameRequired');
      return;
    }
    if (!customerEmail.trim() && !customerPhone.trim()) {
      setCustomerFormError('checkout.customerContactRequired');
      return;
    }
    createCustomer.mutate(
      {
        firstName: customerFirstName.trim(),
        lastName: customerLastName.trim(),
        email: customerEmail.trim() || null,
        phone: customerPhone.trim() || null,
      },
      {
        onError: (err) => setCustomerFormError(err instanceof ApiError ? posErrorKey(err.code) : 'errors.unknown'),
      },
    );
  };

  const formatMinor = (amountMinor: string) => formatMinorAmount(amountMinor, baseCurrency, { locale, exponent });

  return (
    <ModuleGate moduleKey="pos">
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('checkout.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('checkout.subtitle')}</p>
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t(error)}
          </p>
        )}
        {success && (
          <div
            role="status"
            className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
          >
            <p>{t('checkout.success')}</p>
            <p className="mt-1 font-semibold">{t('checkout.receiptNumber', { number: success.receiptNumber })}</p>
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link href={`/${locale}/m/pos/sales/${success.saleId}`}>{t('checkout.viewSale')}</Link>
            </Button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          {/* Left column — register + picker + cart */}
          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div>
                  <p className="text-sm font-medium">{t('checkout.register')}</p>
                  <Combobox
                    className="mt-2"
                    value={registerId}
                    onValueChange={(v) => {
                      setRegisterId(v);
                      setSuccess(null);
                    }}
                    options={(registers?.items ?? []).map((r) => ({
                      value: r.id,
                      label: r.name,
                      hint: r.code,
                    }))}
                    placeholder={registersPending ? t('common.loading') : t('checkout.selectRegister')}
                    searchPlaceholder={t('select.search')}
                    emptyText={t('select.empty')}
                  />
                </div>
                {selectedRegister &&
                  (hasOpenShift ? (
                    <Badge variant="secondary">{t('checkout.shiftOpen')}</Badge>
                  ) : (
                    <p className="text-sm text-destructive">{t('checkout.noOpenShift')}</p>
                  ))}
              </CardContent>
            </Card>

            {/* POS-18: optionally link the sale to a customer — pick an existing
                contact or create one inline. Degrades to an empty list when
                the org has no CRM module. */}
            <Card>
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{t('checkout.customer')}</p>
                  {customerContactId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto px-2 text-xs"
                      onClick={() => setCustomerContactId('')}
                    >
                      {t('checkout.clearCustomer')}
                    </Button>
                  )}
                </div>
                <Combobox
                  value={customerContactId}
                  onValueChange={(v) => {
                    setCustomerContactId(v);
                    setSuccess(null);
                  }}
                  options={(contacts ?? []).map((c) => {
                    const contactHint = c.email ?? c.phone;
                    return {
                      value: c.id,
                      label: `${c.firstName} ${c.lastName}`,
                      ...(contactHint ? { hint: contactHint } : {}),
                    };
                  })}
                  placeholder={t('checkout.selectCustomer')}
                  searchPlaceholder={t('select.search')}
                  emptyText={t('checkout.noCustomers')}
                />
                {newCustomerOpen ? (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        aria-label={t('checkout.customerFirstName')}
                        placeholder={t('checkout.customerFirstName')}
                        value={customerFirstName}
                        onChange={(e) => setCustomerFirstName(e.target.value)}
                      />
                      <Input
                        aria-label={t('checkout.customerLastName')}
                        placeholder={t('checkout.customerLastName')}
                        value={customerLastName}
                        onChange={(e) => setCustomerLastName(e.target.value)}
                      />
                    </div>
                    <Input
                      aria-label={t('checkout.customerEmail')}
                      placeholder={t('checkout.customerEmail')}
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                    />
                    <Input
                      aria-label={t('checkout.customerPhone')}
                      placeholder={t('checkout.customerPhone')}
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                    />
                    {customerFormError && (
                      <p role="alert" className="text-sm text-destructive">
                        {t(customerFormError)}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <Button size="sm" loading={createCustomer.isPending} onClick={() => void handleCreateCustomer()}>
                        {t('checkout.createCustomer')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setNewCustomerOpen(false)}>
                        {t('sale.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setNewCustomerOpen(true)}>
                    <UserPlus className="size-4" aria-hidden="true" />
                    <span className="ms-1">{t('checkout.newCustomer')}</span>
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 pt-6">
                <p className="text-sm font-medium">{t('checkout.addItem')}</p>
                <Combobox
                  value={pickerVariantId}
                  onValueChange={addLine}
                  options={sellable.map((item) => ({
                    value: item.variantId,
                    label: `${localizedLabel(item.nameI18n, locale)} (${item.sku})`,
                    hint: formatMinor(item.unitPriceAmountMinor),
                  }))}
                  placeholder={t('checkout.searchProduct')}
                  searchPlaceholder={t('select.search')}
                  emptyText={sellable.length === 0 ? t('checkout.noSellable') : t('select.empty')}
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 text-start font-medium">{t('checkout.tableProduct')}</th>
                        <th className="px-4 py-3 text-end font-medium">{t('checkout.tablePrice')}</th>
                        <th className="px-4 py-3 text-end font-medium">{t('checkout.tableQty')}</th>
                        <th className="px-4 py-3 text-end font-medium">{t('checkout.tableTotal')}</th>
                        <th className="px-4 py-3 text-end font-medium">{t('checkout.tableActions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {lines.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                            {t('checkout.emptyCart')}
                          </td>
                        </tr>
                      ) : (
                        lines.map((line) => {
                          const lineTotal = lineTotalMinor(line.unitPriceAmountMinor, line.quantity);
                          return (
                            <tr key={line.variantId} className="transition-colors hover:bg-accent/30">
                              <td className="max-w-48 px-4 py-3">
                                <p className="truncate" dir="auto">
                                  {localizedLabel(line.nameI18n, locale)}
                                </p>
                                <p className="font-mono text-xs text-muted-foreground">{line.sku}</p>
                              </td>
                              <td className="px-4 py-3 text-end font-mono text-xs tabular-nums">
                                {formatMinor(line.unitPriceAmountMinor)}
                              </td>
                              <td className="px-4 py-3 text-end">
                                <div className="inline-flex items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label={t('checkout.decreaseQty')}
                                    onClick={() =>
                                      updateQuantity(
                                        line.variantId,
                                        unscaleQuantity(
                                          scaleQuantity(line.quantity) - 10_000n < 10_000n
                                            ? 10_000n
                                            : scaleQuantity(line.quantity) - 10_000n,
                                        ),
                                      )
                                    }
                                  >
                                    <Minus className="size-3.5" aria-hidden="true" />
                                  </Button>
                                  <Input
                                    className="h-8 w-16 font-mono text-center"
                                    inputMode="decimal"
                                    aria-label={t('checkout.tableQty')}
                                    value={line.quantity}
                                    onChange={(e) => updateQuantity(line.variantId, e.target.value)}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    aria-label={t('checkout.increaseQty')}
                                    onClick={() =>
                                      updateQuantity(
                                        line.variantId,
                                        unscaleQuantity(scaleQuantity(line.quantity) + 10_000n),
                                      )
                                    }
                                  >
                                    <Plus className="size-3.5" aria-hidden="true" />
                                  </Button>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-end font-mono text-xs font-semibold tabular-nums">
                                {formatMinor(lineTotal)}
                              </td>
                              <td className="px-4 py-3 text-end">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  aria-label={t('checkout.removeLine')}
                                  onClick={() =>
                                    setLines((current) => current.filter((l) => l.variantId !== line.variantId))
                                  }
                                >
                                  <Trash2 className="size-4" aria-hidden="true" />
                                </Button>
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

          {/* Right column — payment summary */}
          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t('checkout.subtotal')}</span>
                  <span className="font-mono font-semibold tabular-nums">{formatMinor(subtotalMinor)}</span>
                </div>
                <div className="flex items-center justify-between border-t pt-3 text-sm">
                  <span className="font-medium">{t('checkout.total')}</span>
                  <span className="font-mono text-base font-bold tabular-nums">{formatMinor(totalMinor)}</span>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">{t('checkout.paymentMethod')}</p>
                  <Select
                    value={method}
                    onValueChange={(v) => setMethod(v === 'cash' || v === 'card' || v === 'other' ? v : 'cash')}
                  >
                    <SelectItem value="cash">{t('checkout.methodCash')}</SelectItem>
                    <SelectItem value="card">{t('checkout.methodCard')}</SelectItem>
                    <SelectItem value="other">{t('checkout.methodOther')}</SelectItem>
                  </Select>
                </div>

                {method === 'cash' && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{t('checkout.tendered', { currency: baseCurrency })}</p>
                    <Input
                      className="font-mono"
                      inputMode="numeric"
                      aria-label={t('checkout.tendered', { currency: baseCurrency })}
                      value={tenderedAmountMinor}
                      onChange={(e) => setTenderedAmountMinor(e.target.value)}
                    />
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{t('checkout.change')}</span>
                      <span className="font-mono tabular-nums">
                        {formatMinor(tenderedAmountMinor ? changeMinor : '0')}
                      </span>
                    </div>
                  </div>
                )}

                <Button
                  className="w-full"
                  size="lg"
                  loading={checkout.isPending}
                  onClick={() => void handleCheckout()}
                  disabled={lines.length === 0}
                >
                  <ShoppingCart className="size-4" aria-hidden="true" />
                  <span className="ms-1">{t('checkout.completeSale')}</span>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ModuleGate>
  );
}
