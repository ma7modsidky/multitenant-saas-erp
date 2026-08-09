// POS DTOs — request validation schemas (zod) + Swagger response classes.
// Money is ALWAYS integer minor units as strings (hard rule #3); quantities
// are decimal strings (numeric(18,4) UoM units).
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

// ─── Request schemas ────────────────────────────────────────────────────────

const moneySchema = z.object({
  amountMinor: z.string().regex(/^\d+$/, 'amountMinor must be a non-negative integer string (minor units)'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be an uppercase ISO 4217 code'),
});

const quantitySchema = z.string().regex(/^\d+(\.\d+)?$/, 'quantity must be a plain decimal string');

const paymentMethodSchema = z.enum(['cash', 'card', 'other']);

const saleLineSchema = z.object({
  variantId: z.string().uuid(),
  sku: z.string().min(1),
  nameI18n: z.record(z.string(), z.string()),
  quantity: quantitySchema,
  unitPrice: moneySchema,
  lineDiscount: moneySchema.optional(),
  taxRateBp: z.number().int().nonnegative().default(0),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

const paymentSchema = z.object({
  method: paymentMethodSchema,
  amount: moneySchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  tenderedAmountMinor: z.string().regex(/^\d+$/).optional(),
  changeAmountMinor: z.string().regex(/^\d+$/).optional(),
  reference: z.string().nullable().optional(),
});

export const createRegisterSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(30),
  warehouseId: z.string().uuid(),
});

export const openShiftSchema = z.object({
  openingFloatAmountMinor: z.string().regex(/^\d+$/, 'openingFloatAmountMinor must be an integer string'),
});

export const closeShiftSchema = z.object({
  countedCashAmountMinor: z.string().regex(/^\d+$/, 'countedCashAmountMinor must be an integer string'),
  forcedClose: z.boolean().optional(),
});

export const checkoutSchema = z.object({
  registerId: z.string().uuid(),
  locale: z.string().min(1).default('en'),
  lines: z.array(saleLineSchema).min(1, 'a sale requires at least one line'),
  payments: z.array(paymentSchema).min(1, 'a sale requires at least one payment'),
  customerContactId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export const syncSaleSchema = z.object({
  clientDeviceId: z.string().min(1),
  idempotencyKey: z.string().uuid(),
  registerId: z.string().uuid(),
  locale: z.string().min(1).default('en'),
  soldAt: z.string().datetime(),
  lines: z.array(saleLineSchema).min(1),
  payments: z.array(paymentSchema).min(1),
  customerContactId: z.string().uuid().nullable().optional(),
});

export const refundLineSchema = z.object({
  saleLineId: z.string().uuid(),
  variantId: z.string().uuid(),
  quantity: quantitySchema,
  restock: z.boolean().default(true),
  amount: moneySchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const processRefundSchema = z.object({
  originalSaleId: z.string().uuid(),
  registerId: z.string().uuid(),
  reasonCode: z.string().min(1),
  lines: z.array(refundLineSchema).min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

// ─── Inferred DTO types ─────────────────────────────────────────────────────

export type CreateRegisterDto = z.infer<typeof createRegisterSchema>;
export type OpenShiftDto = z.infer<typeof openShiftSchema>;
export type CloseShiftDto = z.infer<typeof closeShiftSchema>;
export type CheckoutDto = z.infer<typeof checkoutSchema>;
export type SyncSaleDto = z.infer<typeof syncSaleSchema>;
export type ProcessRefundDto = z.infer<typeof processRefundSchema>;

// ─── Swagger response classes ───────────────────────────────────────────────

export class PosRegisterResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty() warehouseId!: string;
  @ApiProperty() receiptPrefix!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ nullable: true, required: false }) openShiftId!: string | null;
  @ApiProperty() createdAt!: string;
}

export class PosRegisterEnvelopeResponse {
  @ApiProperty({ type: PosRegisterResponse }) data!: PosRegisterResponse;
}

export class PosRegisterListEnvelopeResponse {
  @ApiProperty({ type: [PosRegisterResponse] }) data!: { items: PosRegisterResponse[] };
}

export class PosShiftResponse {
  @ApiProperty() id!: string;
  @ApiProperty() registerId!: string;
  @ApiProperty() openedBy!: string;
  @ApiProperty() openedAt!: string;
  @ApiProperty() openingFloatAmountMinor!: string;
  @ApiProperty({ nullable: true, required: false }) closedBy!: string | null;
  @ApiProperty({ nullable: true, required: false }) closedAt!: string | null;
  @ApiProperty({ nullable: true, required: false }) countedCashAmountMinor!: string | null;
  @ApiProperty({ nullable: true, required: false }) expectedCashAmountMinor!: string | null;
  @ApiProperty({ nullable: true, required: false }) varianceAmountMinor!: string | null;
  @ApiProperty() currency!: string;
  @ApiProperty() status!: string;
  @ApiProperty() forcedClose!: boolean;
}

export class PosShiftEnvelopeResponse {
  @ApiProperty({ type: PosShiftResponse }) data!: PosShiftResponse;
}

export class PosShiftListEnvelopeResponse {
  @ApiProperty({ type: [PosShiftResponse] }) data!: { items: PosShiftResponse[] };
}

export class PosSaleResponse {
  @ApiProperty() id!: string;
  @ApiProperty() shiftId!: string;
  @ApiProperty() registerId!: string;
  @ApiProperty() receiptNumber!: string;
  @ApiProperty() status!: string;
  @ApiProperty() subtotalAmountMinor!: string;
  @ApiProperty() discountAmountMinor!: string;
  @ApiProperty() taxAmountMinor!: string;
  @ApiProperty() totalAmountMinor!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() locale!: string;
  @ApiProperty() soldAt!: string;
  @ApiProperty() lines!: unknown[];
  @ApiProperty() payments!: unknown[];
}

export class PosSaleEnvelopeResponse {
  @ApiProperty({ type: PosSaleResponse }) data!: PosSaleResponse;
}

export class PosSaleListEnvelopeResponse {
  @ApiProperty({ type: [PosSaleResponse] })
  data!: { items: PosSaleResponse[]; total: number; page: number; pageSize: number };
}

export class PosCheckoutResponse {
  @ApiProperty() saleId!: string;
  @ApiProperty() receiptNumber!: string;
}

export class PosCheckoutEnvelopeResponse {
  @ApiProperty({ type: PosCheckoutResponse }) data!: PosCheckoutResponse;
}

export class PosRefundResponse {
  @ApiProperty() refundId!: string;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() refundedAt!: string;
}

export class PosRefundEnvelopeResponse {
  @ApiProperty({ type: PosRefundResponse }) data!: PosRefundResponse;
}
