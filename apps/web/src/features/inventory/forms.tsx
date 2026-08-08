'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';

import { useCurrencies, useOrgBaseCurrency } from './hooks';
import { variantLabel } from './labels';
import {
  adjustStockFormSchema,
  productFormSchema,
  receiveStockFormSchema,
  stockCountFormSchema,
  transferStockFormSchema,
  variantFormSchema,
  warehouseFormSchema,
  type AdjustStockFormValues,
  type ProductFormValues,
  type ReceiveStockFormValues,
  type StockCountFormValues,
  type StockCountLineValues,
  type TransferStockFormValues,
  type VariantFormValues,
  type WarehouseFormValues,
} from './schemas';

/** Form primitives — local copies of the CRM feature's (feature self-containment). */

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

/** Currency select shared by all money fields. */
function CurrencySelect({
  value,
  onValueChange,
  label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
}) {
  const { data: currencies } = useCurrencies();
  return (
    <Select aria-label={label} className="w-28" value={value} onValueChange={onValueChange}>
      {!currencies ? (
        <SelectItem value="">—</SelectItem>
      ) : (
        currencies.map((currency) => (
          <SelectItem key={currency.code} value={currency.code}>
            {currency.code}
          </SelectItem>
        ))
      )}
    </Select>
  );
}

/**
 * Searchable variant picker fed by the variants list — one entry per SELLABLE
 * variant, so a product with multiple variants shows every SKU (the products
 * list only carries one display variant per product and would hide the rest).
 * Backed by the shared Combobox: type to filter, arrows + Enter to pick — the
 * catalog can be hundreds of SKUs without a wall-of-options dropdown.
 */
export function VariantSelect({
  value,
  onValueChange,
  variants,
  locale,
  placeholder,
  id,
}: {
  value: string;
  onValueChange: (value: string) => void;
  variants: Array<{ variantId: string; nameI18n: Record<string, string>; sku: string }>;
  locale: string;
  placeholder: string;
  /** Assigned to the trigger so a <Label htmlFor> can point at it (a11y). */
  id?: string;
}) {
  const t = useTranslations('modules.inventory');
  return (
    <Combobox
      {...(id ? { id } : {})}
      value={value}
      onValueChange={onValueChange}
      options={variants.map((variant) => ({
        value: variant.variantId,
        // variantLabel is `Name (SKU)` — the label carries the SKU, so no
        // separate hint (the combobox's search matches the label anyway).
        label: variantLabel(variant.nameI18n, variant.sku, locale),
      }))}
      placeholder={placeholder}
      searchPlaceholder={t('select.search')}
      emptyText={t('select.empty')}
    />
  );
}

// ─── Product form ───────────────────────────────────────────────────────────

export function ProductForm({
  onSubmit,
  pending,
  initialValues,
  existingSkus = [],
  submitLabel,
}: {
  onSubmit: (values: ProductFormValues) => Promise<unknown>;
  pending: boolean;
  /** Prefill for edit mode (product name + primary variant fields). */
  initialValues?: Partial<ProductFormValues>;
  /** Other products' SKUs — client-side INV-10 pre-check in edit mode. */
  existingSkus?: string[];
  /** Submit label; defaults to "Add product" (create mode). */
  submitLabel?: string;
}) {
  const t = useTranslations('modules.inventory');
  const baseCurrency = useOrgBaseCurrency();
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(
      productFormSchema.refine(
        (value) => !existingSkus.some((sku) => sku.trim().toLowerCase() === value.sku.trim().toLowerCase()),
        {
          message: t('errors.duplicateSku'),
          path: ['sku'],
        },
      ),
    ),
    defaultValues: {
      nameEn: initialValues?.nameEn ?? '',
      sku: initialValues?.sku ?? '',
      barcode: initialValues?.barcode ?? '',
      priceAmountMinor: initialValues?.priceAmountMinor ?? '0',
      priceCurrency: initialValues?.priceCurrency ?? baseCurrency,
      costAmountMinor: initialValues?.costAmountMinor ?? '0',
      costCurrency: initialValues?.costCurrency ?? baseCurrency,
      reorderPoint: initialValues?.reorderPoint ?? '0',
      reorderQuantity: initialValues?.reorderQuantity ?? '0',
    },
  });

  return (
    <FormCard>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        <Field label={t('fields.name')} htmlFor="product-name" error={form.formState.errors.nameEn?.message}>
          <Input id="product-name" dir="auto" {...form.register('nameEn')} />
        </Field>
        <Field label={t('fields.sku')} htmlFor="product-sku" error={form.formState.errors.sku?.message}>
          <Input id="product-sku" dir="auto" {...form.register('sku')} />
        </Field>
        <Field label={t('fields.barcode')} htmlFor="product-barcode" error={undefined}>
          <Input id="product-barcode" dir="auto" {...form.register('barcode')} />
        </Field>
        <Field label={t('fields.price')} htmlFor="product-price-minor" error={undefined}>
          <div className="flex gap-2">
            <Input
              id="product-price-minor"
              className="font-mono"
              inputMode="numeric"
              {...form.register('priceAmountMinor')}
            />
            <CurrencySelect
              label={t('fields.currency')}
              value={form.watch('priceCurrency')}
              onValueChange={(v) => form.setValue('priceCurrency', v)}
            />
          </div>
        </Field>
        <Field label={t('fields.cost')} htmlFor="product-cost-minor" error={undefined}>
          <div className="flex gap-2">
            <Input
              id="product-cost-minor"
              className="font-mono"
              inputMode="numeric"
              {...form.register('costAmountMinor')}
            />
            <CurrencySelect
              label={t('fields.currency')}
              value={form.watch('costCurrency')}
              onValueChange={(v) => form.setValue('costCurrency', v)}
            />
          </div>
        </Field>
        <Field label={t('fields.reorderPoint')} htmlFor="product-reorder-point" error={undefined}>
          <Input
            id="product-reorder-point"
            className="font-mono"
            inputMode="decimal"
            {...form.register('reorderPoint')}
          />
        </Field>
        <Field label={t('fields.reorderQuantity')} htmlFor="product-reorder-quantity" error={undefined}>
          <Input
            id="product-reorder-quantity"
            className="font-mono"
            inputMode="decimal"
            {...form.register('reorderQuantity')}
          />
        </Field>
        <Button className="md:col-span-2 md:justify-self-start" loading={pending}>
          {submitLabel ?? t('products.create')}
        </Button>
      </form>
    </FormCard>
  );
}

// ─── Add-variant form (INV-10) ─────────────────────────────────────────────

export function VariantForm({
  onSubmit,
  pending,
  existingSkus,
  initialValues,
  submitLabel,
}: {
  onSubmit: (values: VariantFormValues) => Promise<unknown>;
  pending: boolean;
  /** Client-side duplicate SKU pre-check against the product's variants. */
  existingSkus: string[];
  /** Prefill for edit mode. */
  initialValues?: Partial<VariantFormValues>;
  /** Submit label; defaults to "Add variant" (create mode). */
  submitLabel?: string;
}) {
  const t = useTranslations('modules.inventory');
  const baseCurrency = useOrgBaseCurrency();
  const form = useForm<VariantFormValues>({
    resolver: zodResolver(
      variantFormSchema.refine(
        (value) => !existingSkus.some((sku) => sku.trim().toLowerCase() === value.sku.trim().toLowerCase()),
        {
          message: t('errors.duplicateSku'),
          path: ['sku'],
        },
      ),
    ),
    defaultValues: {
      sku: initialValues?.sku ?? '',
      barcode: initialValues?.barcode ?? '',
      priceAmountMinor: initialValues?.priceAmountMinor ?? '0',
      priceCurrency: initialValues?.priceCurrency ?? baseCurrency,
      costAmountMinor: initialValues?.costAmountMinor ?? '0',
      costCurrency: initialValues?.costCurrency ?? baseCurrency,
      reorderPoint: initialValues?.reorderPoint ?? '0',
      reorderQuantity: initialValues?.reorderQuantity ?? '0',
    },
  });

  return (
    <FormCard>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        <Field label={t('fields.sku')} htmlFor="variant-sku" error={form.formState.errors.sku?.message}>
          <Input id="variant-sku" dir="auto" {...form.register('sku')} />
        </Field>
        <Field label={t('fields.barcode')} htmlFor="variant-barcode" error={undefined}>
          <Input id="variant-barcode" dir="auto" {...form.register('barcode')} />
        </Field>
        <Field label={t('fields.price')} htmlFor="variant-price-minor" error={undefined}>
          <div className="flex gap-2">
            <Input
              id="variant-price-minor"
              className="font-mono"
              inputMode="numeric"
              {...form.register('priceAmountMinor')}
            />
            <CurrencySelect
              label={t('fields.currency')}
              value={form.watch('priceCurrency')}
              onValueChange={(v) => form.setValue('priceCurrency', v)}
            />
          </div>
        </Field>
        <Field label={t('fields.cost')} htmlFor="variant-cost-minor" error={undefined}>
          <div className="flex gap-2">
            <Input
              id="variant-cost-minor"
              className="font-mono"
              inputMode="numeric"
              {...form.register('costAmountMinor')}
            />
            <CurrencySelect
              label={t('fields.currency')}
              value={form.watch('costCurrency')}
              onValueChange={(v) => form.setValue('costCurrency', v)}
            />
          </div>
        </Field>
        <Field label={t('fields.reorderPoint')} htmlFor="variant-reorder-point" error={undefined}>
          <Input
            id="variant-reorder-point"
            className="font-mono"
            inputMode="decimal"
            {...form.register('reorderPoint')}
          />
        </Field>
        <Field label={t('fields.reorderQuantity')} htmlFor="variant-reorder-quantity" error={undefined}>
          <Input
            id="variant-reorder-quantity"
            className="font-mono"
            inputMode="decimal"
            {...form.register('reorderQuantity')}
          />
        </Field>
        <Button className="md:col-span-2 md:justify-self-start" loading={pending}>
          {submitLabel ?? t('variants.add')}
        </Button>
      </form>
    </FormCard>
  );
}

// ─── Create-warehouse form ──────────────────────────────────────────────────

export function WarehouseForm({
  onSubmit,
  pending,
  canSetDefault,
}: {
  onSubmit: (values: WarehouseFormValues) => Promise<unknown>;
  pending: boolean;
  /** Only offered when the org has no default warehouse yet. */
  canSetDefault: boolean;
}) {
  const t = useTranslations('modules.inventory');
  const form = useForm<WarehouseFormValues>({
    resolver: zodResolver(warehouseFormSchema),
    defaultValues: { name: '', code: '', isDefault: false },
  });

  return (
    <FormCard>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        {/* fields.name is product-scoped ('Product name') — the warehouse
            name uses its own label so the create form reads correctly. */}
        <Field label={t('warehouses.tableName')} htmlFor="warehouse-name" error={form.formState.errors.name?.message}>
          <Input id="warehouse-name" dir="auto" {...form.register('name')} />
        </Field>
        <Field label={t('fields.code')} htmlFor="warehouse-code" error={form.formState.errors.code?.message}>
          <Input
            id="warehouse-code"
            dir="auto"
            placeholder={t('warehouses.codePlaceholder')}
            {...form.register('code')}
          />
        </Field>
        {canSetDefault && (
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" {...form.register('isDefault')} className="size-4" />
            {t('warehouses.makeDefault')}
          </label>
        )}
        <Button className="md:col-span-2 md:justify-self-start" loading={pending}>
          {t('warehouses.create')}
        </Button>
      </form>
    </FormCard>
  );
}

// ─── Receive / adjust / transfer forms ──────────────────────────────────────

export function ReceiveStockForm({
  variants,
  warehouses,
  onSubmit,
  pending,
  initialValues,
}: {
  variants: Array<{ variantId: string; nameI18n: Record<string, string>; sku: string }>;
  warehouses: Array<{ id: string; name: string }>;
  onSubmit: (values: ReceiveStockFormValues) => Promise<unknown>;
  pending: boolean;
  /** Row-action preselect: the variant (and its warehouse) already chosen. */
  initialValues?: Partial<ReceiveStockFormValues>;
}) {
  const t = useTranslations('modules.inventory');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const form = useForm<ReceiveStockFormValues>({
    resolver: zodResolver(receiveStockFormSchema),
    defaultValues: {
      variantId: initialValues?.variantId ?? '',
      warehouseId: initialValues?.warehouseId ?? '',
      quantity: '0',
      unitCostAmountMinor: '0',
      unitCostCurrency: baseCurrency,
    },
  });

  return (
    <FormCard>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        <Field label={t('fields.product')} htmlFor="receive-variant" error={undefined}>
          <VariantSelect
            id="receive-variant"
            value={form.watch('variantId')}
            onValueChange={(v) => form.setValue('variantId', v)}
            variants={variants}
            locale={locale}
            placeholder={t('receive.selectProduct')}
          />
        </Field>
        <Field label={t('fields.warehouse')} error={undefined}>
          <Select
            value={form.watch('warehouseId')}
            onValueChange={(v) => form.setValue('warehouseId', v)}
            {...form.register('warehouseId')}
          >
            <SelectItem value="">{t('receive.defaultWarehouse')}</SelectItem>
            {warehouses.map((warehouse) => (
              <SelectItem key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field label={t('fields.quantity')} htmlFor="receive-quantity" error={form.formState.errors.quantity?.message}>
          <Input id="receive-quantity" className="font-mono" inputMode="decimal" {...form.register('quantity')} />
        </Field>
        <Field label={t('fields.unitCost')} htmlFor="receive-unit-cost-minor" error={undefined}>
          <div className="flex gap-2">
            <Input
              id="receive-unit-cost-minor"
              className="font-mono"
              inputMode="numeric"
              {...form.register('unitCostAmountMinor')}
            />
            <CurrencySelect
              label={t('fields.currency')}
              value={form.watch('unitCostCurrency')}
              onValueChange={(v) => form.setValue('unitCostCurrency', v)}
            />
          </div>
        </Field>
        <Button className="md:col-span-2 md:justify-self-start" loading={pending}>
          {t('receive.submit')}
        </Button>
      </form>
    </FormCard>
  );
}

export function AdjustStockForm({
  variants,
  warehouses,
  onSubmit,
  pending,
  initialValues,
}: {
  variants: Array<{ variantId: string; nameI18n: Record<string, string>; sku: string }>;
  warehouses: Array<{ id: string; name: string }>;
  onSubmit: (values: AdjustStockFormValues) => Promise<unknown>;
  pending: boolean;
  /** Row-action preselect: the variant (and its warehouse) already chosen. */
  initialValues?: Partial<AdjustStockFormValues>;
}) {
  const t = useTranslations('modules.inventory');
  const locale = useLocale();
  const form = useForm<AdjustStockFormValues>({
    resolver: zodResolver(adjustStockFormSchema),
    defaultValues: {
      variantId: initialValues?.variantId ?? '',
      warehouseId: initialValues?.warehouseId ?? '',
      quantity: '0',
      reasonCode: '',
    },
  });

  return (
    <FormCard>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        <Field label={t('fields.product')} htmlFor="adjust-variant" error={undefined}>
          <VariantSelect
            id="adjust-variant"
            value={form.watch('variantId')}
            onValueChange={(v) => form.setValue('variantId', v)}
            variants={variants}
            locale={locale}
            placeholder={t('adjust.selectProduct')}
          />
        </Field>
        <Field label={t('fields.warehouse')} error={undefined}>
          <Select
            value={form.watch('warehouseId')}
            onValueChange={(v) => form.setValue('warehouseId', v)}
            {...form.register('warehouseId')}
          >
            <SelectItem value="">{t('receive.defaultWarehouse')}</SelectItem>
            {warehouses.map((warehouse) => (
              <SelectItem key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field
          label={t('fields.quantitySigned')}
          htmlFor="adjust-quantity"
          error={form.formState.errors.quantity?.message}
        >
          <Input id="adjust-quantity" className="font-mono" inputMode="decimal" {...form.register('quantity')} />
        </Field>
        <Field label={t('fields.reasonCode')} htmlFor="adjust-reason" error={form.formState.errors.reasonCode?.message}>
          <Input
            id="adjust-reason"
            dir="auto"
            placeholder={t('adjust.reasonPlaceholder')}
            {...form.register('reasonCode')}
          />
        </Field>
        <Button className="md:col-span-2 md:justify-self-start" loading={pending}>
          {t('adjust.submit')}
        </Button>
      </form>
    </FormCard>
  );
}

/**
 * Searchable warehouse picker (combobox) — a multi-location org needs to
 * filter, not scroll a wall of options. Shows the code dimmed next to the name.
 */
export function WarehouseSelect({
  value,
  onValueChange,
  warehouses,
  placeholder,
  id,
}: {
  value: string;
  onValueChange: (value: string) => void;
  warehouses: Array<{ id: string; name: string; code: string }>;
  placeholder: string;
  /** Assigned to the trigger so a <Label htmlFor> can point at it (a11y). */
  id?: string;
}) {
  const t = useTranslations('modules.inventory');
  return (
    <Combobox
      {...(id ? { id } : {})}
      value={value}
      onValueChange={onValueChange}
      options={warehouses.map((warehouse) => ({
        value: warehouse.id,
        label: warehouse.name,
        hint: warehouse.code,
      }))}
      placeholder={placeholder}
      searchPlaceholder={t('select.search')}
      emptyText={t('select.empty')}
    />
  );
}

export function TransferForm({
  variants,
  warehouses,
  onSubmit,
  pending,
  initialValues,
}: {
  variants: Array<{ variantId: string; nameI18n: Record<string, string>; sku: string }>;
  warehouses: Array<{ id: string; name: string; code: string }>;
  onSubmit: (values: TransferStockFormValues) => Promise<unknown>;
  pending: boolean;
  /** Row-action preselect: the variant and from/to warehouses already chosen. */
  initialValues?: Partial<TransferStockFormValues>;
}) {
  const t = useTranslations('modules.inventory');
  const locale = useLocale();
  const form = useForm<TransferStockFormValues>({
    resolver: zodResolver(transferStockFormSchema),
    defaultValues: {
      variantId: initialValues?.variantId ?? '',
      fromWarehouseId: initialValues?.fromWarehouseId ?? '',
      toWarehouseId: initialValues?.toWarehouseId ?? '',
      quantity: '0',
    },
  });

  return (
    <FormCard>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}>
        <Field label={t('fields.product')} htmlFor="transfer-variant" error={undefined}>
          <VariantSelect
            id="transfer-variant"
            value={form.watch('variantId')}
            onValueChange={(v) => form.setValue('variantId', v)}
            variants={variants}
            locale={locale}
            placeholder={t('transfers.selectProduct')}
          />
        </Field>
        <Field label={t('fields.fromWarehouse')} htmlFor="transfer-from" error={undefined}>
          <WarehouseSelect
            id="transfer-from"
            value={form.watch('fromWarehouseId')}
            onValueChange={(v) => form.setValue('fromWarehouseId', v)}
            warehouses={warehouses}
            placeholder={t('transfers.selectWarehouse')}
          />
        </Field>
        <Field
          label={t('fields.toWarehouse')}
          htmlFor="transfer-to"
          error={form.formState.errors.toWarehouseId?.message}
        >
          <WarehouseSelect
            id="transfer-to"
            value={form.watch('toWarehouseId')}
            onValueChange={(v) => form.setValue('toWarehouseId', v)}
            warehouses={warehouses}
            placeholder={t('transfers.selectWarehouse')}
          />
        </Field>
        <Field label={t('fields.quantity')} htmlFor="transfer-quantity" error={form.formState.errors.quantity?.message}>
          <Input id="transfer-quantity" className="font-mono" inputMode="decimal" {...form.register('quantity')} />
        </Field>
        <Button className="md:col-span-2 md:justify-self-start" loading={pending}>
          {t('transfers.submit')}
        </Button>
      </form>
    </FormCard>
  );
}

// ─── Stock count form (INV-14) ──────────────────────────────────────────────

export function StockCountForm({
  variants,
  warehouses,
  onSubmit,
  pending,
}: {
  variants: Array<{ variantId: string; nameI18n: Record<string, string>; sku: string }>;
  warehouses: Array<{ id: string; name: string }>;
  onSubmit: (values: StockCountFormValues & { lines: StockCountLineValues[] }) => Promise<unknown>;
  pending: boolean;
}) {
  const t = useTranslations('modules.inventory');
  const locale = useLocale();
  const form = useForm<StockCountFormValues>({
    resolver: zodResolver(stockCountFormSchema),
    defaultValues: { warehouseId: '', notes: '' },
  });
  const [lines, setLines] = useState<StockCountLineValues[]>([]);
  const [lineVariantId, setLineVariantId] = useState('');
  const [lineQuantity, setLineQuantity] = useState('0');

  const addLine = () => {
    if (!lineVariantId) return;
    // One counted line per variant — re-adding a variant replaces its tally.
    setLines((current) => {
      const without = current.filter((line) => line.variantId !== lineVariantId);
      return [...without, { variantId: lineVariantId, countedQuantity: lineQuantity || '0' }];
    });
    setLineVariantId('');
    setLineQuantity('0');
  };

  const handleSubmit = async (values: StockCountFormValues) => {
    if (lines.length === 0) return;
    await onSubmit({ ...values, lines });
    setLines([]);
  };

  return (
    <FormCard>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}>
        <Field label={t('fields.warehouse')} error={undefined}>
          <Select
            value={form.watch('warehouseId')}
            onValueChange={(v) => form.setValue('warehouseId', v)}
            {...form.register('warehouseId')}
          >
            {warehouses.map((warehouse) => (
              <SelectItem key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field label={t('fields.notes')} htmlFor="count-notes" error={undefined}>
          <Input id="count-notes" dir="auto" {...form.register('notes')} />
        </Field>
        <div className="grid gap-3 md:col-span-2">
          <p className="text-sm font-medium">{t('counts.lines')}</p>
          <div className="grid gap-2 md:grid-cols-[1fr_8rem_auto]">
            <VariantSelect
              value={lineVariantId}
              onValueChange={setLineVariantId}
              variants={variants}
              locale={locale}
              placeholder={t('counts.selectVariant')}
            />
            <Input
              className="font-mono"
              inputMode="decimal"
              aria-label={t('counts.countedQuantity')}
              value={lineQuantity}
              onChange={(e) => setLineQuantity(e.target.value)}
            />
            <Button type="button" variant="outline" onClick={addLine} disabled={!lineVariantId}>
              <Plus className="size-4" aria-hidden="true" />
              <span className="ms-1">{t('counts.addLine')}</span>
            </Button>
          </div>
          {lines.length > 0 ? (
            <ul className="divide-y divide-border rounded-md border">
              {lines.map((line, index) => {
                const variant = variants.find((v) => v.variantId === line.variantId);
                return (
                  <li
                    key={`${line.variantId}-${index}`}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {variant ? variantLabel(variant.nameI18n, variant.sku, locale) : line.variantId}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums">{line.countedQuantity}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('counts.removeLine')}
                      onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{t('counts.noLinesYet')}</p>
          )}
        </div>
        <Button className="md:col-span-2 md:justify-self-start" loading={pending} disabled={lines.length === 0}>
          {t('counts.submit')}
        </Button>
      </form>
    </FormCard>
  );
}
