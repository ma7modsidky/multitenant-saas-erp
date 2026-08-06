import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ─── Shared primitives ──────────────────────────────────────────────────────
//
// Money always travels as integer minor units + ISO 4217 currency (DATA_MODEL
// §5 M1) — never floats (hard rule #3). Quantities are numeric(18,4) decimal
// strings (INV-15).

/** Non-negative integer minor units as a decimal string (e.g. "5000"). */
const amountMinorString = z.string().regex(/^\d+$/, 'amountMinor must be a non-negative integer string');

/** Uppercase ISO 4217 currency code. */
const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'currency must be an uppercase ISO 4217 code');

/**
 * Decimal-string quantity (numeric(18,4), INV-15). Accepts an optional
 * leading minus, integer/fractional digits, up to 4 fractional places.
 */
const quantityString = z
  .string()
  .regex(/^-?\d+(\.\d{1,4})?$/, 'quantity must be a decimal string with at most 4 fractional digits');

// ─── Products ───────────────────────────────────────────────────────────────

/** Create-product request. INV-10: SKU is unique per org among non-deleted variants. */
export const createProductSchema = z
  .object({
    nameI18n: z.record(z.string(), z.string().min(1)).refine((names) => (names.en ?? '').trim().length > 0, {
      message: 'nameI18n must include an "en" name',
    }),
    sku: z.string().trim().min(1, 'SKU is required').max(64),
    barcode: z.string().trim().max(64).nullable().optional(),
    price: z
      .object({ amountMinor: amountMinorString, currency: currencyCode })
      .strict()
      .optional()
      .default({ amountMinor: '0', currency: 'USD' }),
    cost: z
      .object({ amountMinor: amountMinorString, currency: currencyCode })
      .strict()
      .optional()
      .default({ amountMinor: '0', currency: 'USD' }),
    reorderPoint: quantityString.optional().default('0'),
    reorderQuantity: quantityString.optional().default('0'),
  })
  .strict();

/** Request DTO for creating a product. */
export class CreateProductDto extends createZodDto(createProductSchema) {}

// ─── Stock movements ────────────────────────────────────────────────────────

/** Receive-stock request (INV-12: moving-average cost on the variant). */
export const receiveStockSchema = z
  .object({
    variantId: z.string().uuid('variantId must be a valid UUID'),
    warehouseId: z.string().uuid('warehouseId must be a valid UUID').nullable().optional(),
    quantity: quantityString.refine((q) => !q.startsWith('-'), { message: 'receipt quantity must be positive' }),
    unitCost: z
      .object({ amountMinor: amountMinorString, currency: currencyCode })
      .strict()
      .optional()
      .default({ amountMinor: '0', currency: 'USD' }),
    referenceType: z.string().trim().min(1).max(64),
    referenceId: z.string().uuid('referenceId must be a valid UUID'),
    idempotencyKey: z.string().uuid('idempotencyKey must be a valid UUID').optional(),
  })
  .strict();

/** Request DTO for receiving stock. */
export class ReceiveStockDto extends createZodDto(receiveStockSchema) {}

/** Adjust-stock request. INV-4: adjustments always require a reason code. */
export const adjustStockSchema = z
  .object({
    variantId: z.string().uuid('variantId must be a valid UUID'),
    warehouseId: z.string().uuid('warehouseId must be a valid UUID').nullable().optional(),
    quantity: quantityString,
    reasonCode: z.string().trim().min(1, 'INV-4: an adjustment requires a reason code').max(64),
    referenceType: z.string().trim().min(1).max(64),
    referenceId: z.string().uuid('referenceId must be a valid UUID'),
  })
  .strict();

/** Request DTO for adjusting stock. */
export class AdjustStockDto extends createZodDto(adjustStockSchema) {}

/** Transfer-stock request (INV-9: atomic two-way movement). */
export const transferStockSchema = z
  .object({
    variantId: z.string().uuid('variantId must be a valid UUID'),
    fromWarehouseId: z.string().uuid('fromWarehouseId must be a valid UUID'),
    toWarehouseId: z.string().uuid('toWarehouseId must be a valid UUID'),
    quantity: quantityString.refine((q) => !q.startsWith('-'), { message: 'transfer quantity must be positive' }),
    referenceType: z.string().trim().min(1).max(64),
    referenceId: z.string().uuid('referenceId must be a valid UUID'),
  })
  .strict()
  .refine((t) => t.fromWarehouseId !== t.toWarehouseId, {
    message: 'Cannot transfer to the same warehouse',
    path: ['toWarehouseId'],
  });

/** Request DTO for transferring stock. */
export class TransferStockDto extends createZodDto(transferStockSchema) {}

/** Reserve-stock request (INV-7: bounded soft hold). */
export const reserveStockSchema = z
  .object({
    variantId: z.string().uuid('variantId must be a valid UUID'),
    warehouseId: z.string().uuid('warehouseId must be a valid UUID'),
    quantity: quantityString.refine((q) => !q.startsWith('-'), { message: 'reservation quantity must be positive' }),
    holdForSeconds: z.number().int().min(1).max(86400).optional(),
    referenceType: z.string().trim().min(1).max(64),
    referenceId: z.string().uuid('referenceId must be a valid UUID'),
    idempotencyKey: z.string().uuid('idempotencyKey must be a valid UUID').optional(),
  })
  .strict();

/** Request DTO for reserving stock. */
export class ReserveStockDto extends createZodDto(reserveStockSchema) {}

// ─── Stock counts (INV-14) ──────────────────────────────────────────────────

/** Create-stock-count request — a draft with physical tallies. */
export const createStockCountSchema = z
  .object({
    warehouseId: z.string().uuid('warehouseId must be a valid UUID'),
    notes: z.string().trim().max(2000).nullable().optional(),
    lines: z
      .array(
        z
          .object({
            variantId: z.string().uuid('variantId must be a valid UUID'),
            countedQuantity: quantityString,
          })
          .strict(),
      )
      .min(1, 'A stock count needs at least one line'),
  })
  .strict();

/** Request DTO for creating a stock count. */
export class CreateStockCountDto extends createZodDto(createStockCountSchema) {}

// ─── Responses ──────────────────────────────────────────────────────────────

/** Product row response (list + create). */
export const productResponseSchema = z.object({
  id: z.string(),
  nameI18n: z.record(z.string(), z.string()),
  isActive: z.boolean(),
  variantId: z.string().nullable(),
  sku: z.string().nullable(),
  price: z.object({ amountMinor: z.string(), currency: z.string() }).nullable(),
  reorderPoint: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export class ProductResponse extends createZodDto(productResponseSchema) {}
export class ProductEnvelopeResponse extends createZodDto(z.object({ data: productResponseSchema })) {}
export class ProductListEnvelopeResponse extends createZodDto(
  z.object({ data: z.object({ items: z.array(productResponseSchema) }) }),
) {}

/** Stock level row response. */
export const stockLevelResponseSchema = z.object({
  variantId: z.string(),
  sku: z.string(),
  nameI18n: z.record(z.string(), z.string()),
  warehouseId: z.string(),
  warehouseName: z.string(),
  quantityOnHand: z.string(),
  quantityReserved: z.string(),
  quantityAvailable: z.string(),
  reorderPoint: z.string(),
});

export class StockLevelResponse extends createZodDto(stockLevelResponseSchema) {}
export class StockLevelListEnvelopeResponse extends createZodDto(
  z.object({ data: z.object({ items: z.array(stockLevelResponseSchema) }) }),
) {}

/** Warehouse row response. */
export const warehouseResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});

export class WarehouseResponse extends createZodDto(warehouseResponseSchema) {}
export class WarehouseListEnvelopeResponse extends createZodDto(
  z.object({ data: z.object({ items: z.array(warehouseResponseSchema) }) }),
) {}

/** Movement result response. */
export const movementResultResponseSchema = z.object({
  movementId: z.string(),
});

export class MovementResultResponse extends createZodDto(movementResultResponseSchema) {}
export class MovementResultEnvelopeResponse extends createZodDto(z.object({ data: movementResultResponseSchema })) {}

/** Reservation result response. */
export const reservationResultResponseSchema = z.object({
  reservationId: z.string(),
  expiresAt: z.string(),
});

export class ReservationResultResponse extends createZodDto(reservationResultResponseSchema) {}
export class ReservationResultEnvelopeResponse extends createZodDto(
  z.object({ data: reservationResultResponseSchema }),
) {}

/** Stock count response. */
export const stockCountResponseSchema = z.object({
  id: z.string(),
  warehouseId: z.string(),
  status: z.enum(['draft', 'applied']),
  countedAt: z.string().nullable(),
  countedBy: z.string().nullable(),
  notes: z.string().nullable(),
  lines: z.array(
    z.object({
      id: z.string(),
      variantId: z.string(),
      expectedQuantity: z.string(),
      countedQuantity: z.string(),
      variance: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class StockCountResponse extends createZodDto(stockCountResponseSchema) {}
export class StockCountEnvelopeResponse extends createZodDto(z.object({ data: stockCountResponseSchema })) {}
export class StockCountListEnvelopeResponse extends createZodDto(
  z.object({ data: z.object({ items: z.array(stockCountResponseSchema) }) }),
) {}
