import { z } from 'zod';

/**
 * Decimal-string quantity (numeric(18,4), INV-15) — matches the API boundary
 * validation. Signed for adjustments, unsigned for receipts/transfers/counts.
 */
const signedQuantity = z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'Quantity must be a decimal with at most 4 places');
const unsignedQuantity = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'Quantity must be a positive decimal with at most 4 places');

/** Non-negative integer minor units (money — hard rule #3). */
const amountMinor = z.string().regex(/^\d+$/, 'Amount must be a non-negative integer');

/** Uppercase ISO 4217 currency code. */
const currency = z.string().regex(/^[A-Z]{3}$/, 'Enter an uppercase ISO 4217 code');

/**
 * Product form. `nameEn` is the primary-language name; the API stores it as
 * `nameI18n: { en }` (other locales can be added later — the product name is
 * translatable, MODULE_GUIDE §4).
 */
export const productFormSchema = z.object({
  nameEn: z.string().trim().min(1, 'Product name is required').max(120),
  sku: z.string().trim().min(1, 'SKU is required').max(64),
  barcode: z.string().trim().max(64),
  priceAmountMinor: amountMinor,
  priceCurrency: currency,
  costAmountMinor: amountMinor,
  costCurrency: currency,
  reorderPoint: unsignedQuantity,
  reorderQuantity: unsignedQuantity,
});

/** Receive-stock form (INV-12: moving-average cost needs the unit cost). */
export const receiveStockFormSchema = z.object({
  variantId: z.string().uuid(),
  warehouseId: z.string().uuid().or(z.literal('')),
  quantity: unsignedQuantity,
  unitCostAmountMinor: amountMinor,
  unitCostCurrency: currency,
});

/** Adjust-stock form (INV-4: adjustments always require a reason code). */
export const adjustStockFormSchema = z.object({
  variantId: z.string().uuid(),
  warehouseId: z.string().uuid().or(z.literal('')),
  quantity: signedQuantity,
  reasonCode: z.string().trim().min(1, 'INV-4: an adjustment requires a reason code').max(64),
});

/** Transfer-stock form (INV-9: atomic two-way movement). */
export const transferStockFormSchema = z
  .object({
    variantId: z.string().uuid(),
    fromWarehouseId: z.string().uuid(),
    toWarehouseId: z.string().uuid(),
    quantity: unsignedQuantity,
  })
  .refine((value) => value.fromWarehouseId !== value.toWarehouseId, {
    message: 'From and to warehouses must be different',
    path: ['toWarehouseId'],
  });

/** One stock-count line (INV-14 physical tally). */
export const stockCountLineSchema = z.object({
  variantId: z.string().uuid(),
  countedQuantity: unsignedQuantity,
});

/** Add-variant form (INV-10: SKU unique per org among non-deleted variants). */
export const variantFormSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required').max(64),
  barcode: z.string().trim().max(64),
  priceAmountMinor: amountMinor,
  priceCurrency: currency,
  costAmountMinor: amountMinor,
  costCurrency: currency,
  reorderPoint: unsignedQuantity,
  reorderQuantity: unsignedQuantity,
});

/** Create-warehouse form (code is unique per org among non-deleted). */
export const warehouseFormSchema = z.object({
  name: z.string().trim().min(1, 'Warehouse name is required').max(120),
  code: z.string().trim().min(1, 'Warehouse code is required').max(16),
  isDefault: z.boolean(),
});

/** Stock-count form — the lines are managed separately on the page. */
export const stockCountFormSchema = z.object({
  warehouseId: z.string().uuid(),
  notes: z.string().trim().max(2000),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;
export type VariantFormValues = z.infer<typeof variantFormSchema>;
export type WarehouseFormValues = z.infer<typeof warehouseFormSchema>;
export type ReceiveStockFormValues = z.infer<typeof receiveStockFormSchema>;
export type AdjustStockFormValues = z.infer<typeof adjustStockFormSchema>;
export type TransferStockFormValues = z.infer<typeof transferStockFormSchema>;
export type StockCountFormValues = z.infer<typeof stockCountFormSchema>;
export type StockCountLineValues = z.infer<typeof stockCountLineSchema>;
