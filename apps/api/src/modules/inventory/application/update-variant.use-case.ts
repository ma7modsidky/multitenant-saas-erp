import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ProductVariant } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

export interface UpdateVariantInput {
  sku?: string;
  barcode?: string | null;
  priceAmountMinor?: string;
  priceCurrency?: string;
  costAmountMinor?: string;
  costCurrency?: string;
  reorderPoint?: string;
  reorderQuantity?: string;
}

/**
 * UpdateVariantUseCase — edits a variant's sellable fields (SKU, barcode,
 * price/cost, reorder levels).
 *
 * Business rules:
 * - INV-10: a changed SKU stays unique per org among non-deleted variants
 *   (case-insensitive) — the variant itself is excluded from the check.
 * - INV-11: archived variants are excluded by the repository filter
 *   (`deleted_at IS NULL`), so history can never be edited.
 *
 * Catalog metadata only — the ledger and stock projections are untouched.
 */
@Injectable()
export class UpdateVariantUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(variantId: string, input: UpdateVariantInput): Promise<{ variantId: string; updatedAt: string }> {
    const now = new Date();

    await this.txManager.run(async (tx) => {
      const row = await this.repo.findVariantById(variantId, tx);
      if (!row) throw new NotFoundError('VARIANT_NOT_FOUND', { variantId });

      const variant = ProductVariant.fromPersistence(row);
      const nextSku = input.sku?.trim() ?? row.sku;

      // Apply the new values to the entity FIRST — the domain guard compares
      // the entity's OWN sku against the org's other variants, so it must
      // already carry the new SKU. `row` stays untouched (fromPersistence
      // copies), so the change-detection below still sees the old SKU. The
      // in-memory mutation is harmless on throw (tx aborts).
      variant.updateDetails(
        {
          sku: nextSku,
          barcode: input.barcode !== undefined ? input.barcode : row.barcode,
          priceAmountMinor: input.priceAmountMinor ?? row.priceAmountMinor,
          priceCurrency: input.priceCurrency ?? row.priceCurrency,
          costAmountMinor: input.costAmountMinor ?? row.costAmountMinor,
          costCurrency: input.costCurrency ?? row.costCurrency,
          reorderPoint: input.reorderPoint ?? row.reorderPoint,
          reorderQuantity: input.reorderQuantity ?? row.reorderQuantity,
        },
        now,
      );

      // INV-10: only check uniqueness when the SKU actually changes — editing
      // a variant keeps its own SKU valid (self is excluded).
      if (nextSku.toLowerCase() !== row.sku.trim().toLowerCase()) {
        const existing = await this.repo.findVariantBySku(nextSku, tx);
        if (existing && existing.id !== variantId) {
          variant.assertSkuUniqueIn(new Set([existing.sku.trim().toLowerCase()]));
        }
      }

      await this.repo.updateVariant(variant.toJSON(), tx);
    });

    return { variantId, updatedAt: now.toISOString() };
  }
}
