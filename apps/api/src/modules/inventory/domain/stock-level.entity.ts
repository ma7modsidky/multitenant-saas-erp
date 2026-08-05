import { InventoryError, INVENTORY_ERROR_CODE } from './errors.js';
import { isQuantityShort, subtractQuantity } from './quantity.js';

/**
 * StockLevel — the derived projection of the movement ledger (INV-2).
 *
 * INV-5: available = quantity_on_hand − quantity_reserved. Sales and
 * reservations validate against *available*, never on-hand.
 */
export class StockLevel {
  private constructor(
    readonly variantId: string,
    readonly warehouseId: string,
    /** SUM(quantity) over movements for (variant, warehouse) — INV-2. */
    readonly quantityOnHand: string,
    /** SUM of held reservations — INV-5. */
    readonly quantityReserved: string,
  ) {}

  /** Start from the ledger sum. */
  static fromLedger(variantId: string, warehouseId: string, quantityOnHand: string): StockLevel {
    return new StockLevel(variantId, warehouseId, quantityOnHand, '0');
  }

  static of(variantId: string, warehouseId: string, quantityOnHand: string, quantityReserved: string): StockLevel {
    return new StockLevel(variantId, warehouseId, quantityOnHand, quantityReserved);
  }

  /** INV-5 — the number sales and reservations actually validate against. */
  get available(): string {
    return subtractQuantity(this.quantityOnHand, this.quantityReserved);
  }

  /**
   * INV-5 sales gate: rejects when `requested` exceeds available.
   * Negative available can only be reached via a documented oversold path
   * (INV-6); the ordinary path must fail with INSUFFICIENT_STOCK.
   */
  assertSufficient(requested: string): void {
    if (isQuantityShort(this.available, requested)) {
      throw new InventoryError(
        INVENTORY_ERROR_CODE.INSUFFICIENT_STOCK,
        `Only ${this.available} available (on-hand ${this.quantityOnHand} − reserved ${this.quantityReserved}).`,
        { variantId: this.variantId, warehouseId: this.warehouseId, available: this.available },
      );
    }
  }

  toJSON(): {
    variantId: string;
    warehouseId: string;
    quantityOnHand: string;
    quantityReserved: string;
    available: string;
  } {
    return {
      variantId: this.variantId,
      warehouseId: this.warehouseId,
      quantityOnHand: this.quantityOnHand,
      quantityReserved: this.quantityReserved,
      available: this.available,
    };
  }
}
