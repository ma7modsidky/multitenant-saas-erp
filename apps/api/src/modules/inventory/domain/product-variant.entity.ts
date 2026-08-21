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
  /** ACC-11: product-level tax rate in basis points (inv_products.tax_rate_bp). */
  taxRateBp?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** Actor stamps (inv_product_variants.created_by/updated_by) — audit trail. */
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
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
    const taxRateBp = data.taxRateBp ?? 0;
    if (!Number.isInteger(taxRateBp) || taxRateBp < 0) {
      throw new InventoryError(
        INVENTORY_ERROR_CODE.TAX_RATE_INVALID,
        'A variant tax rate must be a non-negative integer in basis points (ACC-11).',
        { taxRateBp },
      );
    }
    return new ProductVariant({ ...data, taxRateBp });
  }

  /**
   * Reconstruct from persistence (already valid — no invariant re-check).
   * Copies the data so mutating the entity (archive/updateDetails) never
   * mutates the repository's row object in place.
   */
  static fromPersistence(data: ProductVariantData): ProductVariant {
    return new ProductVariant({ ...data });
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
   * INV-11 inverse: unarchives the variant (is_active = true, soft delete
   * lifted) so it is sellable again. Rejected when it is not currently
   * archived. History is never touched — the ledger stays the source of truth.
   */
  unarchive(by: string, at = new Date()): void {
    if (this.data.deletedAt === null) {
      throw new InventoryError(INVENTORY_ERROR_CODE.VARIANT_NOT_ARCHIVED, 'This variant is not archived.');
    }
    this.data.isActive = true;
    this.data.deletedAt = null;
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

  /**
   * Edits the variant's sellable fields (SKU, barcode, price/cost, reorder
   * levels). Archived variants are excluded at the repository boundary
   * (`findVariantById` filters `deleted_at IS NULL`), so editing history is
   * impossible; this method only touches catalog metadata — never the ledger.
   */
  updateDetails(
    details: {
      sku: string;
      barcode: string | null;
      priceAmountMinor: string;
      priceCurrency: string;
      costAmountMinor: string;
      costCurrency: string;
      reorderPoint: string;
      reorderQuantity: string;
    },
    at: Date,
  ): void {
    this.data.sku = details.sku.trim();
    this.data.barcode = details.barcode ?? null;
    this.data.priceAmountMinor = details.priceAmountMinor;
    this.data.priceCurrency = details.priceCurrency;
    this.data.costAmountMinor = details.costAmountMinor;
    this.data.costCurrency = details.costCurrency;
    this.data.reorderPoint = details.reorderPoint;
    this.data.reorderQuantity = details.reorderQuantity;
    this.data.updatedAt = at;
  }
}
