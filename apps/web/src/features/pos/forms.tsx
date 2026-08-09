'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { useOrgBaseCurrency } from './hooks';
import { localizedLabel } from './labels';
import { prorateRefundAmount, scaleQuantity } from './money';
import {
  closeShiftFormSchema,
  openShiftFormSchema,
  refundFormSchema,
  registerFormSchema,
  type CloseShiftFormValues,
  type OpenShiftFormValues,
  type RefundFormValues,
  type RefundLineValues,
  type RegisterFormValues,
} from './schemas';

/** Form primitives — local copies of the inventory feature's (feature self-containment). */

export function FormCard({ children }: { children: React.ReactNode }) {
  return (
    <Card className="border-primary/20">
      <CardContent className="pt-6">{children}</CardContent>
    </Card>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  /** Associates the label with the control (a11y + getByLabel in E2E). */
  htmlFor?: string;
  error: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Searchable combobox picker — used for registers and warehouses. */
function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  id,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string; hint?: string }>;
  placeholder: string;
  id?: string;
}) {
  const t = useTranslations('modules.pos');
  return (
    <Combobox
      {...(id ? { id } : {})}
      value={value}
      onValueChange={onValueChange}
      options={options}
      placeholder={placeholder}
      searchPlaceholder={t('select.search')}
      emptyText={t('select.empty')}
    />
  );
}

// ─── Create-register form (POS-1) ───────────────────────────────────────────

export function RegisterForm({
  warehouses,
  onSubmit,
  pending,
}: {
  warehouses: Array<{ id: string; name: string; code: string }>;
  onSubmit: (values: RegisterFormValues) => Promise<unknown>;
  pending: boolean;
}) {
  const t = useTranslations('modules.pos');
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { name: '', code: '', warehouseId: '' },
  });

  return (
    <FormCard>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        <Field label={t('register.fields.name')} htmlFor="register-name" error={form.formState.errors.name?.message}>
          <Input id="register-name" dir="auto" {...form.register('name')} />
        </Field>
        <Field label={t('register.fields.code')} htmlFor="register-code" error={form.formState.errors.code?.message}>
          <Input id="register-code" dir="auto" {...form.register('code')} />
        </Field>
        <Field
          label={t('register.fields.warehouse')}
          htmlFor="register-warehouse"
          error={form.formState.errors.warehouseId?.message}
        >
          <SearchableSelect
            id="register-warehouse"
            value={form.watch('warehouseId')}
            onValueChange={(v) => form.setValue('warehouseId', v)}
            options={warehouses.map((w) => ({ value: w.id, label: w.name, hint: w.code }))}
            placeholder={t('register.fields.selectWarehouse')}
          />
        </Field>
        <Button className="md:col-span-2 md:justify-self-start" loading={pending}>
          {t('register.create')}
        </Button>
      </form>
    </FormCard>
  );
}

// ─── Open-shift form (POS-2/3) ──────────────────────────────────────────────

export function OpenShiftForm({
  registerLabel,
  onSubmit,
  pending,
}: {
  /** The register this shift will open on (displayed for clarity). */
  registerLabel: string | null;
  onSubmit: (values: OpenShiftFormValues) => Promise<unknown>;
  pending: boolean;
}) {
  const t = useTranslations('modules.pos');
  const baseCurrency = useOrgBaseCurrency();
  const form = useForm<OpenShiftFormValues>({
    resolver: zodResolver(openShiftFormSchema),
    defaultValues: { openingFloatAmountMinor: '0' },
  });

  return (
    <FormCard>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        <div className="md:col-span-2 text-sm text-muted-foreground">
          {registerLabel ? t('register.openFor', { register: registerLabel }) : ''}
        </div>
        <Field
          label={t('register.openForm.floatLabel', { currency: baseCurrency })}
          htmlFor="open-shift-float"
          error={form.formState.errors.openingFloatAmountMinor?.message}
        >
          <Input
            id="open-shift-float"
            className="font-mono"
            inputMode="numeric"
            {...form.register('openingFloatAmountMinor')}
          />
        </Field>
        <Button className="md:col-span-2 md:justify-self-start" loading={pending}>
          {t('register.openForm.submit')}
        </Button>
      </form>
    </FormCard>
  );
}

// ─── Close-shift form (POS-4/5) ─────────────────────────────────────────────

export function CloseShiftForm({
  registerLabel,
  onSubmit,
  pending,
}: {
  /** The register this shift will close on (displayed for clarity). */
  registerLabel: string | null;
  onSubmit: (values: CloseShiftFormValues) => Promise<unknown>;
  pending: boolean;
}) {
  const t = useTranslations('modules.pos');
  const baseCurrency = useOrgBaseCurrency();
  const form = useForm<CloseShiftFormValues>({
    resolver: zodResolver(closeShiftFormSchema),
    defaultValues: { countedCashAmountMinor: '0', forcedClose: false },
  });

  return (
    <FormCard>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        <div className="md:col-span-2 text-sm text-muted-foreground">
          {registerLabel ? t('register.closeFor', { register: registerLabel }) : ''}
        </div>
        <Field
          label={t('register.closeForm.countedLabel', { currency: baseCurrency })}
          htmlFor="close-shift-counted"
          error={form.formState.errors.countedCashAmountMinor?.message}
        >
          <Input
            id="close-shift-counted"
            className="font-mono"
            inputMode="numeric"
            {...form.register('countedCashAmountMinor')}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" {...form.register('forcedClose')} className="size-4" />
          {t('register.closeForm.forcedLabel')}
        </label>
        <Button className="md:col-span-2 md:justify-self-start" loading={pending}>
          {t('register.closeForm.submit')}
        </Button>
      </form>
    </FormCard>
  );
}

// ─── Refund dialog (POS-20..24) ─────────────────────────────────────────────

/**
 * RefundDialog — the refund flow for one sale. Built on the design-system
 * Card + a fixed overlay (same pattern as ConfirmDialog): a per-line quantity
 * (default = the line's full quantity), a restock toggle, a reason code, and
 * the register to refund through (must have an open shift — POS-23).
 */
export function RefundDialog({
  open,
  onClose,
  registers,
  currency,
  refundableLines,
  onSubmit,
  pending,
  defaultRegisterId,
}: {
  open: boolean;
  onClose: () => void;
  registers: Array<{ id: string; name: string; code: string }>;
  /** The sale's lines with their remaining refundable quantity (POS-21). */
  currency: string;
  refundableLines: Array<{
    saleLineId: string;
    variantId: string;
    skuSnapshot: string;
    nameSnapshot: Record<string, string>;
    quantity: string;
    amountMinor: string;
  }>;
  onSubmit: (values: RefundFormValues) => Promise<unknown>;
  pending: boolean;
  /** Default refund register — the sale's own register (POS-23 needs an open shift). */
  defaultRegisterId?: string;
}) {
  const t = useTranslations('modules.pos');
  const locale = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const [registerId, setRegisterId] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [lines, setLines] = useState<RefundLineValues[]>([]);

  // Rebuild the editable lines whenever the dialog opens (fresh default
  // quantities from the sale's current state, restock on by default).
  useEffect(() => {
    if (!open) return;
    setRegisterId(
      defaultRegisterId && registers.some((r) => r.id === defaultRegisterId)
        ? defaultRegisterId
        : (registers[0]?.id ?? ''),
    );
    setReasonCode('');
    setLines(
      refundableLines.map((line) => ({
        saleLineId: line.saleLineId,
        variantId: line.variantId,
        quantity: line.quantity,
        restock: true,
        amountMinor: line.amountMinor,
        currency,
      })),
    );
    panelRef.current?.focus();
    // Intentionally `[open]` only — the lines are rebuilt fresh on each open;
    // `registers`/`currency`/`refundableLines` are captured at open time.
  }, [open, registers, currency, refundableLines, defaultRegisterId]);

  // Escape closes (suppressed while pending, matching the disabled buttons).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, pending, onClose]);

  if (!open) return null;

  const updateLine = (saleLineId: string, patch: Partial<RefundLineValues>) => {
    setLines((current) =>
      current.map((line) => {
        if (line.saleLineId !== saleLineId) return line;
        const next = { ...line, ...patch };
        // Re-prorate the refund amount whenever the quantity changes — the
        // server re-validates POS-21 caps, but the dialog's line total should
        // reflect the user's current quantity (never exceed the line total).
        if (patch.quantity !== undefined) {
          const original = refundableLines.find((l) => l.saleLineId === saleLineId);
          if (original) {
            // Client-side POS-21 cap: clamp to the line's quantity so an
            // over-refund is caught here instead of failing server-side.
            if (scaleQuantity(next.quantity) > scaleQuantity(original.quantity)) {
              next.quantity = original.quantity;
            }
            next.amountMinor = prorateRefundAmount(original.amountMinor, original.quantity, next.quantity);
          }
        }
        return next;
      }),
    );
  };

  const handleSubmit = async () => {
    const parsed = refundFormSchema.safeParse({ registerId, reasonCode, currency, lines });
    if (!parsed.success) return;
    await onSubmit(parsed.data);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="refund-dialog-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50 cursor-default"
        onClick={onClose}
        disabled={pending}
        aria-hidden="true"
        tabIndex={-1}
        data-testid="refund-dialog-backdrop"
      />
      <div ref={panelRef} tabIndex={-1} className="relative w-full max-w-lg outline-none animate-fade-in">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4">
              <CardTitle id="refund-dialog-title" className="text-base">
                {t('refund.dialogTitle')}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="-me-1 -mt-1 size-7"
                onClick={onClose}
                disabled={pending}
                aria-label={t('refund.close')}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t('refund.register')} htmlFor="refund-register" error={undefined}>
                <SearchableSelect
                  id="refund-register"
                  value={registerId}
                  onValueChange={setRegisterId}
                  options={registers.map((r) => ({ value: r.id, label: r.name, hint: r.code }))}
                  placeholder={t('refund.selectRegister')}
                />
              </Field>
              <Field label={t('refund.reasonCode')} htmlFor="refund-reason" error={undefined}>
                <Input
                  id="refund-reason"
                  dir="auto"
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t('refund.lines')}</p>
              <ul className="divide-y divide-border rounded-md border">
                {lines.map((line) => {
                  const original = refundableLines.find((l) => l.saleLineId === line.saleLineId);
                  return (
                    <li key={line.saleLineId} className="grid gap-2 px-3 py-2 text-sm md:grid-cols-[1fr_7rem_auto]">
                      <div className="min-w-0">
                        <p className="truncate">
                          {original ? localizedLabel(original.nameSnapshot, locale) : line.variantId}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">{original?.skuSnapshot}</p>
                      </div>
                      <Input
                        className="h-8 font-mono"
                        inputMode="decimal"
                        aria-label={t('refund.quantity')}
                        value={line.quantity}
                        onChange={(e) => updateLine(line.saleLineId, { quantity: e.target.value })}
                      />
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={line.restock}
                          onChange={(e) => updateLine(line.saleLineId, { restock: e.target.checked })}
                          className="size-4"
                        />
                        {t('refund.restock')}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              {t('refund.cancel')}
            </Button>
            <Button onClick={() => void handleSubmit()} loading={pending}>
              {t('refund.submit')}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
