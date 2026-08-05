import { InventoryError, INVENTORY_ERROR_CODE } from './errors.js';

/** Persisted shape of an inventory product variant (inv_product_variants). */
export interface ProductVariantData {
  id: string;
  organizationId: string;
  productId: string;
  sku: string;
  barcode: string | null;
  attributes: Record<string, unknown>;
  priceAmountMinor: string;
  priceCurrency: string;
  costAmountMinor: string;
  costCurrency: string;
  reorderPoint: string;
  reorderQuantity: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * ProductVariant — a sellable unit.
 *
 * Pure TypeScript, no framework imports (hard rule #7).
 *
 * Rules enforced here:
 * - INV-10: SKU and barcode are unique per organization among non-deleted
 *   variants (`VARIANT_DUPLICATE_SKU`). The DB enforces the same invariant
 *   with partial unique indexes; `assertSkuUniqueIn` is the in-process guard
 *   the use case calls after reading existing variants from the repository.
 * - INV-11: a variant with any stock movement history cannot be hard-deleted,
 *   only archived (`is_active = false`, then soft delete).
 */
export class ProductVariant {
  private constructor(private readonly data: ProductVariantData) {}

  static create(data: ProductVariantData): ProductVariant {
    if (!data.sku.trim()) {
      throw new InventoryError(INVENTORY_ERROR_CODE.VARIANT_DUPLICATE_SKU, 'A variant requires an SKU.');
    }
    return new ProductVariant({ ...data });
  }

  /** Reconstruct from persistence (already valid — no invariant re-check). */
  static fromPersistence(data: ProductVariantData): ProductVariant {
    return new ProductVariant(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get productId(): string {
    return this.data.productId;
  }
  get sku(): string {
    return this.data.sku;
  }
  get barcode(): string | null {
    return this.data.barcode;
  }
  get reorderPoint(): string {
    return this.data.reorderPoint;
  }
  get isActive(): boolean {
    return this.data.isActive;
  }
  get deletedAt(): Date | null {
    return this.data.deletedAt;
  }

  toJSON(): ProductVariantData {
    return { ...this.data };
  }

  // ─── Behaviour ──────────────────────────────────────────────────────────────

  /**
   * INV-10: rejects a duplicate SKU within the organization.
   * Emails/SKUs are compared case-insensitively — the caller passes the set of
   * the org's *other non-deleted* variants' normalized SKUs.
   */
  assertSkuUniqueIn(otherOrgSkus: ReadonlySet<string>): void {
    const normalized = this.data.sku.trim().toLowerCase();
    for (const existing of otherOrgSkus) {
      if (existing === normalized) {
        throw new InventoryError(
          INVENTORY_ERROR_CODE.VARIANT_DUPLICATE_SKU,
          `A variant with SKU "${this.data.sku}" already exists in this organization.`,
          { sku: this.data.sku },
        );
      }
    }
  }

  /**
   * INV-11: archives the variant (is_active = false, then soft delete).
   * Rejected only if the variant was already deleted; history is never touched.
   */
  archive(by: string, at = new Date()): void {
    if (this.data.deletedAt !== null) {
      throw new InventoryError(INVENTORY_ERROR_CODE.VARIANT_HAS_MOVEMENT_HISTORY, 'This variant is already deleted.');
    }
    this.data.isActive = false;
    this.data.deletedAt = at;
    this.data.updatedAt = at;
  }

  /**
   * INV-11: a variant with movement history can only be archived, never
   * hard-deleted. Called by the repository/use case when a hard delete is
   * attempted and movement history exists.
   */
  assertDeletable(hasMovementHistory: boolean): void {
    if (hasMovementHistory) {
      throw new InventoryError(
        INVENTORY_ERROR_CODE.VARIANT_HAS_MOVEMENT_HISTORY,
        'A variant with stock movement history cannot be hard-deleted; archive it instead.',
      );
    }
  }
}
