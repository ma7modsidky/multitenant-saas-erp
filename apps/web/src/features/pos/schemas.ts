import { z } from 'zod';

/** Non-negative integer minor units (money — hard rule #3). */
const amountMinor = z.string().regex(/^\d+$/, 'Amount must be a non-negative integer');

/** Uppercase ISO 4217 currency code. */
const currency = z.string().regex(/^[A-Z]{3}$/, 'Enter an uppercase ISO 4217 code');

/** Decimal-string quantity (numeric(18,4)). */
const unsignedQuantity = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'Quantity must be a positive decimal with at most 4 places');

/** Create-register form (POS-1; code unique per org among non-deleted). */
export const registerFormSchema = z.object({
  name: z.string().trim().min(1, 'Register name is required').max(120),
  code: z.string().trim().min(1, 'Register code is required').max(30),
  warehouseId: z.string().uuid(),
});

/** Open-shift form (POS-2/3) — the starting float in the drawer. */
export const openShiftFormSchema = z.object({
  openingFloatAmountMinor: amountMinor,
});

/** Close-shift form (POS-4/5) — counted cash; variance computed server-side. */
export const closeShiftFormSchema = z.object({
  countedCashAmountMinor: amountMinor,
  forcedClose: z.boolean(),
});

/** One cart line — mirrors the checkout DTO's `lines` entry. */
export const cartLineSchema = z.object({
  variantId: z.string().uuid(),
  sku: z.string().min(1),
  nameI18n: z.record(z.string(), z.string()),
  quantity: unsignedQuantity,
  unitPriceAmountMinor: amountMinor,
  /** ACC-11: the product's tax rate in basis points (the backend falls back to the default). */
  taxRateBp: z.number().int().min(0).optional(),
  currency,
});

/** Checkout form — the cart lines plus the payment method + cash fields. */
export const checkoutFormSchema = z
  .object({
    registerId: z.string().uuid(),
    lines: z.array(cartLineSchema).min(1, 'Add at least one item to the cart'),
    method: z.enum(['cash', 'card', 'other']),
    tenderedAmountMinor: amountMinor,
  })
  .refine((value) => value.method !== 'cash' || value.tenderedAmountMinor !== '', {
    message: 'Enter the cash tendered',
    path: ['tenderedAmountMinor'],
  });

/** Refund form (POS-20..24) — one entry per refunded line. */
export const refundLineSchema = z.object({
  saleLineId: z.string().uuid(),
  variantId: z.string().uuid(),
  /** Refundable = remaining quantity on the line (client cap; server re-checks). */
  quantity: unsignedQuantity,
  restock: z.boolean(),
  /** Prorated line amount, computed client-side (server re-validates POS-21). */
  amountMinor: amountMinor,
  currency,
});

export const refundFormSchema = z.object({
  registerId: z.string().uuid(),
  reasonCode: z.string().trim().min(1, 'A refund requires a reason (POS-23)').max(120),
  currency,
  lines: z.array(refundLineSchema).min(1, 'Select at least one line to refund'),
});

export type RegisterFormValues = z.infer<typeof registerFormSchema>;
export type OpenShiftFormValues = z.infer<typeof openShiftFormSchema>;
export type CloseShiftFormValues = z.infer<typeof closeShiftFormSchema>;
export type CartLineValues = z.infer<typeof cartLineSchema>;
export type CheckoutFormValues = z.infer<typeof checkoutFormSchema>;
export type RefundLineValues = z.infer<typeof refundLineSchema>;
export type RefundFormValues = z.infer<typeof refundFormSchema>;
