import { describe, expect, it } from 'vitest';

import {
  INVENTORY_ERROR_CODE,
  MOVEMENT_TYPE,
  RESERVATION_STATE,
  InventoryError,
  ProductVariant,
  Reservation,
  STOCK_COUNT_STATUS,
  type ReservationState,
  StockCount,
  StockLevel,
  StockMovement,
  addQuantity,
  compareQuantity,
  isQuantityShort,
  movingAverageCost,
  subtractQuantity,
} from '../../domain/index.js';

/** Assert that `action` throws an InventoryError carrying `expectedCode`. */
function expectInventoryError(action: () => void, expectedCode: string): void {
  try {
    action();
    expect.fail('Expected InventoryError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(InventoryError);
    expect((error as InventoryError).code).toBe(expectedCode);
  }
}

const orgId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const variantId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const warehouseId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const userId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

// ─── Quantity helpers (INV-15) ───────────────────────────────────────────────

describe('quantity helpers (INV-15: no floating-point comparisons)', () => {
  it('compares fractional quantities exactly', () => {
    expect(compareQuantity('0.1', '0.1000')).toBe(0);
    expect(compareQuantity('1.0001', '1.0000')).toBe(1);
    expect(compareQuantity('2', '10')).toBe(-1);
  });

  it('adds and subtracts decimals without float drift', () => {
    expect(addQuantity('0.1', '0.2')).toBe('0.3');
    expect(subtractQuantity('1', '0.0001')).toBe('0.9999');
  });

  it('INV-5: available is the gate — 10 on-hand, 3 reserved leaves 7', () => {
    expect(isQuantityShort('7', '7')).toBe(false);
    expect(isQuantityShort('7', '7.0001')).toBe(true);
  });

  it('INV-12: moving average stays exact — 10@4.00 + 5@5.00 → 4.3333', () => {
    expect(movingAverageCost('10', '400', '5', '500')).toBe('433');
  });

  it('INV-12: moving average with a fresh receipt on zero stock is the unit cost', () => {
    expect(movingAverageCost('0', '0', '3.5', '1200')).toBe('1200');
  });

  it('INV-12: never rounds through floats — fractional on-hand is exact', () => {
    // (1.5 × 1000 + 0.5 × 2000) / 2.0 = 1250 — no float drift.
    expect(movingAverageCost('1.5', '1000', '0.5', '2000')).toBe('1250');
  });
});

// ─── StockMovement (INV-3, INV-4) ────────────────────────────────────────────

function movementData(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e0000000-0000-0000-0000-000000000000',
    organizationId: orgId,
    variantId,
    warehouseId,
    type: MOVEMENT_TYPE.RECEIPT,
    quantity: '10',
    unitCostAmountMinor: '5000',
    unitCostCurrency: 'USD',
    referenceType: 'purchase_order',
    referenceId: 'f0000000-0000-0000-0000-000000000000',
    reasonCode: null,
    idempotencyKey: null,
    occurredAt: new Date('2026-08-04T10:00:00Z'),
    createdBy: userId,
    ...overrides,
  };
}

describe('StockMovement', () => {
  it('INV-3: rejects a zero quantity movement', () => {
    expectInventoryError(
      () => StockMovement.create(movementData({ quantity: '0' })),
      INVENTORY_ERROR_CODE.MOVEMENT_ZERO_QUANTITY,
    );
  });

  it('INV-3: accepts a negative (stock-out) movement with a reference', () => {
    const movement = StockMovement.create(movementData({ type: MOVEMENT_TYPE.SALE, quantity: '-2.5' }));
    expect(movement.isInbound).toBe(false);
  });

  it('INV-3: rejects a movement without a reference', () => {
    expectInventoryError(
      () => StockMovement.create(movementData({ referenceType: '' })),
      INVENTORY_ERROR_CODE.MOVEMENT_REFERENCE_REQUIRED,
    );
  });

  it('INV-4: rejects an adjustment without a reason code', () => {
    expectInventoryError(
      () => StockMovement.create(movementData({ type: MOVEMENT_TYPE.ADJUSTMENT, quantity: '-1' })),
      INVENTORY_ERROR_CODE.ADJUSTMENT_REQUIRES_REASON,
    );
  });

  it('INV-4: accepts an adjustment carrying a reason code', () => {
    const movement = StockMovement.create(
      movementData({ type: MOVEMENT_TYPE.ADJUSTMENT, quantity: '-1', reasonCode: 'SHRINKAGE' }),
    );
    expect(movement.reasonCode).toBe('SHRINKAGE');
  });
});

// ─── StockLevel (INV-2, INV-5) ───────────────────────────────────────────────

describe('StockLevel', () => {
  it('INV-2: starts from the ledger sum and exposes the projection', () => {
    const level = StockLevel.fromLedger(variantId, warehouseId, '42.5');
    expect(level.quantityOnHand).toBe('42.5');
  });

  it('INV-5: available = on-hand − reserved', () => {
    const level = StockLevel.of(variantId, warehouseId, '10', '3');
    expect(level.available).toBe('7');
  });

  it('INV-5: rejects an online sale exceeding available stock with INSUFFICIENT_STOCK', () => {
    const level = StockLevel.of(variantId, warehouseId, '10', '3');
    expectInventoryError(() => level.assertSufficient('7.0001'), INVENTORY_ERROR_CODE.INSUFFICIENT_STOCK);
  });

  it('INV-5: allows a sale exactly at the available quantity', () => {
    const level = StockLevel.of(variantId, warehouseId, '10', '3');
    expect(() => level.assertSufficient('7')).not.toThrow();
  });
});

// ─── Reservation (INV-7, INV-8) ──────────────────────────────────────────────

function reservationData(state: ReservationState = RESERVATION_STATE.HELD, overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    organizationId: orgId,
    variantId,
    warehouseId,
    quantity: '2',
    state,
    expiresAt: new Date(Date.now() + 15 * 60_000),
    referenceType: 'pos_sale',
    referenceId: '22222222-2222-2222-2222-222222222222',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Reservation', () => {
  it('INV-8: held → committed is legal', () => {
    const reservation = Reservation.create(reservationData());
    reservation.commit();
    expect(reservation.state).toBe(RESERVATION_STATE.COMMITTED);
  });

  it('INV-8: held → released is legal', () => {
    const reservation = Reservation.create(reservationData());
    reservation.release();
    expect(reservation.state).toBe(RESERVATION_STATE.RELEASED);
  });

  it('INV-8: rejects an illegal reservation transition (committed → released)', () => {
    const reservation = Reservation.create(reservationData(RESERVATION_STATE.COMMITTED));
    expectInventoryError(() => reservation.release(), INVENTORY_ERROR_CODE.RESERVATION_ILLEGAL_TRANSITION);
  });

  it('INV-7: an expired held reservation cannot be committed, only expired', () => {
    const expired = Reservation.create(
      reservationData(RESERVATION_STATE.HELD, { expiresAt: new Date(Date.now() - 1000) }),
    );
    expect(expired.isExpired()).toBe(true);
    expectInventoryError(() => expired.commit(), INVENTORY_ERROR_CODE.RESERVATION_EXPIRED);
    expired.expire();
    expect(expired.state).toBe(RESERVATION_STATE.EXPIRED);
  });
});

// ─── ProductVariant (INV-10, INV-11) ─────────────────────────────────────────

function variantData(overrides: Record<string, unknown> = {}) {
  return {
    id: variantId,
    organizationId: orgId,
    productId: '33333333-3333-3333-3333-333333333333',
    sku: 'ESP-001',
    barcode: null,
    attributes: {},
    priceAmountMinor: '1000',
    priceCurrency: 'USD',
    costAmountMinor: '400',
    costCurrency: 'USD',
    reorderPoint: '5',
    reorderQuantity: '20',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('ProductVariant', () => {
  it('INV-10: rejects a duplicate SKU per organization', () => {
    const variant = ProductVariant.create(variantData());
    expectInventoryError(
      () => variant.assertSkuUniqueIn(new Set(['esp-001'])),
      INVENTORY_ERROR_CODE.VARIANT_DUPLICATE_SKU,
    );
    expect(() => variant.assertSkuUniqueIn(new Set(['OTHER-SKU']))).not.toThrow();
  });

  it('INV-11: rejects hard-deleting a variant with stock movement history', () => {
    const variant = ProductVariant.create(variantData());
    expectInventoryError(() => variant.assertDeletable(true), INVENTORY_ERROR_CODE.VARIANT_HAS_MOVEMENT_HISTORY);
    expect(() => variant.assertDeletable(false)).not.toThrow();
  });

  it('INV-11: archiving soft-deletes without touching movement history', () => {
    const variant = ProductVariant.create(variantData());
    variant.archive(userId);
    expect(variant.isActive).toBe(false);
    expect(variant.deletedAt).not.toBeNull();
  });
});

// ─── StockCount (INV-14) ─────────────────────────────────────────────────────

function countData(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-4444-444444444444',
    organizationId: orgId,
    warehouseId,
    status: STOCK_COUNT_STATUS.DRAFT,
    countedAt: null,
    countedBy: null,
    notes: null,
    lines: [{ id: 'l1', variantId, expectedQuantity: '10', countedQuantity: '9', variance: '-1' }],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('StockCount', () => {
  it('INV-14: a draft may be edited', () => {
    const count = StockCount.create(countData());
    expect(() => count.updateLines([], userId)).not.toThrow();
  });

  it('INV-14: an applied stock count is immutable', () => {
    const count = StockCount.create(countData());
    count.apply(userId);
    expect(count.status).toBe(STOCK_COUNT_STATUS.APPLIED);
    expectInventoryError(() => count.updateLines([], userId), INVENTORY_ERROR_CODE.STOCK_COUNT_APPLIED_IMMUTABLE);
  });

  it('INV-14: applying generates count_correction movements for every variance', () => {
    const count = StockCount.create(
      countData({
        lines: [
          { id: 'l1', variantId, expectedQuantity: '10', countedQuantity: '9', variance: '-1' },
          { id: 'l2', variantId, expectedQuantity: '5', countedQuantity: '5', variance: '0' },
        ],
      }),
    );
    count.apply(userId);
    expect(count.corrections()).toEqual([{ variantId, quantity: '-1' }]);
  });
});
