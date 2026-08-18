// Purchasing DTOs — request validation schemas (zod) + Swagger response
// classes. Money is ALWAYS integer minor units as strings (hard rule #3).
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

// ─── Shared primitives ──────────────────────────────────────────────────────

const moneySchema = z.object({
  amountMinor: z.string().regex(/^\d+$/, 'amountMinor must be a non-negative integer string (minor units)'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be an uppercase ISO 4217 code'),
});

const quantitySchema = z.string().regex(/^\d+(\.\d+)?$/, 'quantity must be a plain decimal string');

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)');

const paymentTermsSchema = z.object({
  netDays: z.number().int().min(0).optional(),
  discountDays: z.number().int().min(0).optional(),
  discountRateBp: z.number().int().min(0).optional(),
});

const lineInputSchema = z.object({
  variantId: z.string().uuid().nullable().optional(),
  itemNameSnapshot: z.string().min(1),
  quantity: quantitySchema.optional(),
  unitCostMinor: z.string().regex(/^\d+$/),
  unitCostCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  discountMinor: z.string().regex(/^\d+$/).optional(),
  taxRateBpSnapshot: z.number().int().min(0).optional(),
});

// ─── Suppliers (PUR-1) ──────────────────────────────────────────────────────

export const createSupplierSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    taxId: z.string().trim().max(50).nullable().optional(),
    paymentTerms: paymentTermsSchema.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    contactName: z.string().max(200).nullable().optional(),
    contactEmail: z.string().email().nullable().optional(),
    contactPhone: z.string().max(50).nullable().optional(),
    address: z.record(z.unknown()).nullable().optional(),
    bankAccount: z.record(z.unknown()).nullable().optional(),
  })
  .strict();

export const updateSupplierSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    taxId: z.string().trim().max(50).nullable().optional(),
    paymentTerms: paymentTermsSchema.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    contactName: z.string().max(200).nullable().optional(),
    contactEmail: z.string().email().nullable().optional(),
    contactPhone: z.string().max(50).nullable().optional(),
    address: z.record(z.unknown()).nullable().optional(),
    bankAccount: z.record(z.unknown()).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'at least one field is required' });

// ─── Requisitions (PUR-12) ─────────────────────────────────────────────────

export const submitRequisitionSchema = z
  .object({
    requiredByDate: isoDateSchema.nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    lines: z.array(lineInputSchema).min(1),
  })
  .strict();

// ─── Purchase orders (PUR-3, PUR-8) ────────────────────────────────────────

export const createPurchaseOrderSchema = z
  .object({
    supplierId: z.string().uuid(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    orderDate: isoDateSchema.optional(),
    expectedDate: isoDateSchema.nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    lines: z.array(lineInputSchema).min(1),
  })
  .strict();

// ─── GRN receiving (PUR-4) ─────────────────────────────────────────────────

export const receiveGrnSchema = z
  .object({
    poId: z.string().uuid(),
    warehouseId: z.string().uuid().nullable().optional(),
    // PUR-13: client-generated key so a retried receipt is a no-op.
    idempotencyKey: z.string().uuid().nullable().optional(),
    lines: z
      .array(
        z
          .object({
            poLineId: z.string().uuid(),
            variantId: z.string().uuid().nullable().optional(),
            quantity: quantitySchema,
            unitCostMinor: z.string().regex(/^\d+$/),
            unitCostCurrency: z
              .string()
              .regex(/^[A-Z]{3}$/)
              .optional(),
            accepted: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

// ─── Bills (PUR-6) ─────────────────────────────────────────────────────────

export const createBillSchema = z
  .object({
    supplierId: z.string().uuid(),
    poId: z.string().uuid().nullable().optional(),
    grnId: z.string().uuid().nullable().optional(),
    billDate: isoDateSchema.optional(),
    dueDate: isoDateSchema.nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    supplierTaxIdSnapshot: z.string().max(50).nullable().optional(),
    // PUR-13: client-generated key so a retried approval is a no-op.
    idempotencyKey: z.string().uuid().nullable().optional(),
    lines: z
      .array(
        z
          .object({
            poLineId: z.string().uuid().nullable().optional(),
            grnLineId: z.string().uuid().nullable().optional(),
            variantId: z.string().uuid().nullable().optional(),
            // PUR-6: item name snapshot persisted on the bill line (shown on
            // the bill document; the PO line's name is the fallback).
            itemNameSnapshot: z.string().max(200).optional(),
            quantity: quantitySchema,
            unitCostMinor: z.string().regex(/^\d+$/),
            unitCostCurrency: z
              .string()
              .regex(/^[A-Z]{3}$/)
              .optional(),
            taxRateBpSnapshot: z.number().int().min(0).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

// ─── Supplier payments (PUR-7) ─────────────────────────────────────────────

export const recordPaymentSchema = z
  .object({
    supplierId: z.string().uuid(),
    method: z.enum(['cash', 'bank_transfer', 'card', 'cheque', 'other']),
    amountMinor: z.string().regex(/^\d+$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    paidAt: z.string().datetime().optional(),
    reference: z.string().max(200).nullable().optional(),
    allocations: z
      .array(
        z
          .object({
            billId: z.string().uuid(),
            amountMinor: z.string().regex(/^\d+$/),
          })
          .strict(),
      )
      .min(1),
    // PUR-13: client-generated key so a retried payment is a no-op.
    idempotencyKey: z.string().uuid().nullable().optional(),
  })
  .strict();

// ─── Supplier returns (PUR-11) ─────────────────────────────────────────────

export const createSupplierReturnSchema = z
  .object({
    supplierId: z.string().uuid(),
    billId: z.string().uuid().nullable().optional(),
    grnLineId: z.string().uuid().nullable().optional(),
    reasonCode: z.string().trim().min(1).max(200),
    currency: z.string().regex(/^[A-Z]{3}$/),
    lines: z
      .array(
        z
          .object({
            variantId: z.string().uuid().nullable().optional(),
            quantity: quantitySchema,
            unitCostMinor: z.string().regex(/^\d+$/),
            unitCostCurrency: z
              .string()
              .regex(/^[A-Z]{3}$/)
              .optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const approveSchema = z
  .object({
    // PUR-13: client-generated key so a retried approval is a no-op.
    idempotencyKey: z.string().uuid().nullable().optional(),
  })
  .strict();

// ─── Response classes (Swagger) ────────────────────────────────────────────

export class SupplierResponse {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) taxId!: string | null;
  @ApiProperty() currency!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() balanceMinor!: string;
}

export class SupplierListEnvelopeResponse {
  @ApiProperty({ type: SupplierResponse, isArray: true }) items!: SupplierResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class SupplierEnvelopeResponse {
  @ApiProperty() supplier!: Record<string, unknown>;
  @ApiProperty() balanceMinor!: string;
  @ApiProperty({ type: Object, isArray: true }) ledger!: Record<string, unknown>[];
}

export class PurchaseOrderResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() supplierId!: string;
  @ApiProperty() supplierNameSnapshot!: string;
  @ApiProperty() status!: string;
  @ApiProperty() totalMinor!: string;
  @ApiProperty() currency!: string;
}

export class PurchaseOrderListEnvelopeResponse {
  @ApiProperty({ type: PurchaseOrderResponse, isArray: true }) items!: PurchaseOrderResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class PurchaseOrderEnvelopeResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() status!: string;
}

export class PurchaseOrderDetailEnvelopeResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() supplierNameSnapshot!: string;
  @ApiProperty() status!: string;
}

export class GrnResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() poId!: string;
  @ApiProperty() poNumber!: string;
  @ApiProperty() supplierNameSnapshot!: string;
  @ApiProperty() status!: string;
}

export class GrnListEnvelopeResponse {
  @ApiProperty({ type: GrnResponse, isArray: true }) items!: GrnResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class GrnEnvelopeResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() status!: string;
}

export class BillResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() supplierId!: string;
  @ApiProperty() supplierNameSnapshot!: string;
  @ApiProperty() status!: string;
  @ApiProperty() totalMinor!: string;
  @ApiProperty() currency!: string;
}

export class BillListEnvelopeResponse {
  @ApiProperty({ type: BillResponse, isArray: true }) items!: BillResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class BillEnvelopeResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() status!: string;
}

export class PaymentResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() supplierId!: string;
  @ApiProperty() supplierNameSnapshot!: string;
  @ApiProperty() method!: string;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() paidAt!: string;
}

export class PaymentListEnvelopeResponse {
  @ApiProperty({ type: PaymentResponse, isArray: true }) items!: PaymentResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class PaymentEnvelopeResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
}

export class PaymentDetailEnvelopeResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() supplierNameSnapshot!: string;
  @ApiProperty() method!: string;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() currency!: string;
}

export class SupplierReturnResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() supplierId!: string;
  @ApiProperty() supplierNameSnapshot!: string;
  @ApiProperty() reasonCode!: string;
  @ApiProperty() status!: string;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() currency!: string;
}

export class SupplierReturnListEnvelopeResponse {
  @ApiProperty({ type: SupplierReturnResponse, isArray: true }) items!: SupplierReturnResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class SupplierReturnEnvelopeResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() status!: string;
}

export class SupplierReturnDetailEnvelopeResponse {
  @ApiProperty() id!: string;
  @ApiProperty() number!: string;
  @ApiProperty() supplierNameSnapshot!: string;
  @ApiProperty() reasonCode!: string;
  @ApiProperty() status!: string;
  @ApiProperty() amountMinor!: string;
}

export class VendorBalancesEnvelopeResponse {
  @ApiProperty({ type: Object, isArray: true }) suppliers!: Record<string, unknown>[];
  @ApiProperty() totalBalanceMinor!: string;
}

export class RequisitionEnvelopeResponse {
  @ApiProperty() requisitionId!: string;
  @ApiProperty() status!: string;
}

// ─── Inferred DTO types (used by the controller for the validated body) ─────

export type CreateSupplierDto = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierDto = z.infer<typeof updateSupplierSchema>;
export type SubmitRequisitionDto = z.infer<typeof submitRequisitionSchema>;
export type CreatePurchaseOrderDto = z.infer<typeof createPurchaseOrderSchema>;
export type ReceiveGrnDto = z.infer<typeof receiveGrnSchema>;
export type CreateBillDto = z.infer<typeof createBillSchema>;
export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;
export type CreateSupplierReturnDto = z.infer<typeof createSupplierReturnSchema>;
export type ApproveDto = z.infer<typeof approveSchema>;
