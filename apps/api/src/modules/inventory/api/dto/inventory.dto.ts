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

/** Add-variant request (INV-10: SKU unique per org among non-deleted variants). */
export const addVariantSchema = z
  .object({
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

/** Request DTO for adding a variant to an existing product. */
export class AddVariantDto extends createZodDto(addVariantSchema) {}

/** Update-product request — catalog metadata only (name/description). */
export const updateProductSchema = z
  .object({
    nameI18n: z
      .record(z.string(), z.string().min(1))
      .refine((names) => (names.en ?? '').trim().length > 0, {
        message: 'nameI18n must include an "en" name',
      })
      .optional(),
    descriptionI18n: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine((patch) => patch.nameI18n !== undefined || patch.descriptionI18n !== undefined, {
    message: 'At least one of nameI18n or descriptionI18n is required',
  });

/** Request DTO for updating a product. */
export class UpdateProductDto extends createZodDto(updateProductSchema) {}

/** Update-variant request (INV-10: changed SKU stays unique per org). */
export const updateVariantSchema = z
  .object({
    sku: z.string().trim().min(1, 'SKU is required').max(64).optional(),
    barcode: z.string().trim().max(64).nullable().optional(),
    price: z.object({ amountMinor: amountMinorString, currency: currencyCode }).strict().optional(),
    cost: z.object({ amountMinor: amountMinorString, currency: currencyCode }).strict().optional(),
    reorderPoint: quantityString.optional(),
    reorderQuantity: quantityString.optional(),
  })
  .strict()
  .refine(
    (patch) =>
      patch.sku !== undefined ||
      patch.barcode !== undefined ||
      patch.price !== undefined ||
      patch.cost !== undefined ||
      patch.reorderPoint !== undefined ||
      patch.reorderQuantity !== undefined,
    { message: 'At least one variant field is required' },
  );

/** Request DTO for updating a variant. */
export class UpdateVariantDto extends createZodDto(updateVariantSchema) {}

/** Create-warehouse request (code is unique per org among non-deleted). */
export const createWarehouseSchema = z
  .object({
    name: z.string().trim().min(1, 'Warehouse name is required').max(120),
    code: z.string().trim().min(1, 'Warehouse code is required').max(16),
    isDefault: z.boolean().optional().default(false),
  })
  .strict();

/** Request DTO for creating a warehouse. */
export class CreateWarehouseDto extends createZodDto(createWarehouseSchema) {}

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
  /** Number of non-deleted variants (INV-11) — the products-table "Variants" column. */
  variantCount: z.number().int().nonnegative(),
  /**
   * Every variant of the product (active + archived, INV-11), primary first —
   * the grouped products table renders these rows under a product header.
   */
  variants: z.array(
    z.object({
      id: z.string(),
      sku: z.string(),
      price: z.object({ amountMinor: z.string(), currency: z.string() }),
      reorderPoint: z.string(),
      isActive: z.boolean(),
    }),
  ),
});

export class ProductResponse extends createZodDto(productResponseSchema) {}
export class ProductEnvelopeResponse extends createZodDto(z.object({ data: productResponseSchema })) {}

/** Paged product list — items plus total/page/pageSize for pagination UI. */
export const productListResponseSchema = z.object({
  items: z.array(productResponseSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export class ProductListEnvelopeResponse extends createZodDto(z.object({ data: productListResponseSchema })) {}

/** Sellable variant row (variant pickers — one row per variant). */
export const variantListResponseSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  sku: z.string(),
  nameI18n: z.record(z.string(), z.string()),
});

export class VariantListResponse extends createZodDto(variantListResponseSchema) {}

/** Paged variant list — items plus total/page/pageSize for picker fetches. */
export const variantListEnvelopeSchema = z.object({
  items: z.array(variantListResponseSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export class VariantListEnvelopeResponse extends createZodDto(z.object({ data: variantListEnvelopeSchema })) {}

/** Add-variant result response. */
export const addVariantResultResponseSchema = z.object({
  variantId: z.string(),
});

export class AddVariantResultEnvelopeResponse extends createZodDto(
  z.object({ data: addVariantResultResponseSchema }),
) {}

/** Stock level row response. */
export const stockLevelResponseSchema = z.object({
  variantId: z.string(),
  sku: z.string(),
  /** Owning product — the stock page groups variant rows under it. */
  productId: z.string(),
  nameI18n: z.record(z.string(), z.string()),
  /** Null for a never-received variant when the org has no warehouse yet. */
  warehouseId: z.string().nullable(),
  warehouseName: z.string().nullable(),
  quantityOnHand: z.string(),
  quantityReserved: z.string(),
  quantityAvailable: z.string(),
  reorderPoint: z.string(),
  /** INV-2 — last movement id that updated this projection. */
  lastMovementId: z.string().nullable(),
  /** Variant unit cost (stock valuation widget / reports). */
  unitCost: z.object({ amountMinor: z.string(), currency: z.string() }).nullable(),
});

export class StockLevelResponse extends createZodDto(stockLevelResponseSchema) {}

/** Paged stock-level list — items plus total/page/pageSize for pagination UI. */
export const stockLevelListResponseSchema = z.object({
  items: z.array(stockLevelResponseSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export class StockLevelListEnvelopeResponse extends createZodDto(z.object({ data: stockLevelListResponseSchema })) {}

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
export class WarehouseEnvelopeResponse extends createZodDto(z.object({ data: warehouseResponseSchema })) {}

/** One reservation row (list view). */
export const reservationRowResponseSchema = z.object({
  id: z.string(),
  variantId: z.string(),
  sku: z.string(),
  nameI18n: z.record(z.string(), z.string()),
  warehouseId: z.string(),
  warehouseName: z.string(),
  quantity: z.string(),
  state: z.enum(['held', 'committed', 'released', 'expired']),
  expiresAt: z.string(),
  referenceType: z.string(),
  referenceId: z.string(),
  createdAt: z.string(),
});

export class ReservationRowResponse extends createZodDto(reservationRowResponseSchema) {}

/** Paged reservation list — items plus total/page/pageSize for pagination UI. */
export const reservationListResponseSchema = z.object({
  items: z.array(reservationRowResponseSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export class ReservationListEnvelopeResponse extends createZodDto(z.object({ data: reservationListResponseSchema })) {}

/** One append-only stock movement row (INV-1 ledger view). */
export const movementResponseSchema = z.object({
  id: z.string(),
  type: z.string(),
  /** Owning variant — transfers pair movements by variant for repeat. */
  variantId: z.string(),
  sku: z.string(),
  nameI18n: z.record(z.string(), z.string()),
  warehouseId: z.string().nullable(),
  warehouseName: z.string().nullable(),
  quantity: z.string(),
  unitCost: z.object({ amountMinor: z.string(), currency: z.string() }).nullable(),
  referenceType: z.string(),
  referenceId: z.string(),
  reasonCode: z.string().nullable(),
  occurredAt: z.string(),
  createdBy: z.string().nullable(),
});

export class MovementResponse extends createZodDto(movementResponseSchema) {}

/** Paged movements ledger — items plus total/page/pageSize for pagination UI. */
export const movementListResponseSchema = z.object({
  items: z.array(movementResponseSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export class MovementListEnvelopeResponse extends createZodDto(z.object({ data: movementListResponseSchema })) {}

/** One variant inside the product detail response. */
export const productVariantResponseSchema = z.object({
  id: z.string(),
  productId: z.string(),
  sku: z.string(),
  barcode: z.string().nullable(),
  price: z.object({ amountMinor: z.string(), currency: z.string() }),
  cost: z.object({ amountMinor: z.string(), currency: z.string() }),
  reorderPoint: z.string(),
  reorderQuantity: z.string(),
  isActive: z.boolean(),
  /** Actor stamps — who created / last edited this variant (audit trail). */
  createdByUserId: z.string().nullable(),
  updatedByUserId: z.string().nullable(),
  stock: z.array(stockLevelResponseSchema),
});

/** Product detail response — product + variants + stock + ledger history. */
export const productDetailResponseSchema = z.object({
  product: z.object({
    id: z.string(),
    nameI18n: z.record(z.string(), z.string()),
    descriptionI18n: z.record(z.string(), z.string()),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    /** Actor stamps — who created / last edited this product (audit trail). */
    createdByUserId: z.string().nullable(),
    updatedByUserId: z.string().nullable(),
  }),
  variants: z.array(productVariantResponseSchema),
  movements: z.array(movementResponseSchema),
});

export class ProductDetailEnvelopeResponse extends createZodDto(z.object({ data: productDetailResponseSchema })) {}

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

/** Paged stock-count list — items plus total/page/pageSize for pagination UI. */
export const stockCountListResponseSchema = z.object({
  items: z.array(stockCountResponseSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export class StockCountListEnvelopeResponse extends createZodDto(z.object({ data: stockCountListResponseSchema })) {}

/** Stock-count detail response — count + warehouse name + enriched lines. */
export const stockCountDetailResponseSchema = z.object({
  id: z.string(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  status: z.enum(['draft', 'applied']),
  countedAt: z.string().nullable(),
  countedBy: z.string().nullable(),
  notes: z.string().nullable(),
  lines: z.array(
    z.object({
      id: z.string(),
      variantId: z.string(),
      sku: z.string(),
      nameI18n: z.record(z.string(), z.string()),
      expectedQuantity: z.string(),
      countedQuantity: z.string(),
      variance: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class StockCountDetailEnvelopeResponse extends createZodDto(
  z.object({ data: stockCountDetailResponseSchema }),
) {}
