import { INVENTORY_EVENTS, type InventoryProductRestoredV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ProductVariant } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

/**
 * UnarchiveProductUseCase — restores a PRODUCT (INV-11 inverse): every
 * archived variant is unarchived (`is_active = true`, soft delete lifted), so
 * the product becomes sellable again. Already-active variants are untouched.
 *
 * INV-10 edge case: while a variant was archived its SKU was free — another
 * variant may have claimed it. Restoring aborts with the duplicate-SKU error
 * when that happened, keeping the org-wide uniqueness invariant.
 *
 * Emits one `inventory.product.restored.v1` carrying every restored variant id
 * after commit.
 */
@Injectable()
export class UnarchiveProductUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(productId: string): Promise<{ restoredAt: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      const product = await this.repo.findProductById(productId, tx);
      if (!product) throw new NotFoundError('PRODUCT_NOT_FOUND', { productId });

      const variants = await this.repo.listVariantsByProduct(productId, tx);
      // Only archived variants flip back now; active ones are left untouched.
      const variantIds = variants.filter((row) => row.deletedAt !== null).map((row) => row.id);

      for (const row of variants) {
        if (row.deletedAt === null) continue;
        const variant = ProductVariant.fromPersistence(row);
        variant.unarchive(userId ?? 'system', now);

        // INV-10: an archived SKU may have been claimed while unavailable.
        const existing = await this.repo.findVariantBySku(variant.sku, tx);
        if (existing && existing.id !== variant.id) {
          variant.assertSkuUniqueIn(new Set([existing.sku.trim().toLowerCase()]));
        }

        await this.repo.unarchiveVariant(variant.id, now, userId, tx);
      }

      const payload: InventoryProductRestoredV1 = {
        organizationId,
        productId,
        variantIds,
        restoredAt: now.toISOString(),
        occurredAt: now.toISOString(),
      };
      const event =
        variantIds.length > 0
          ? ({
              name: INVENTORY_EVENTS.PRODUCT_RESTORED_V1,
              payload,
              aggregateId: productId,
            } satisfies Parameters<UnitOfWork['addEvent']>[0])
          : null;

      return { restoredAt: now.toISOString(), event };
    });

    // Nothing changed (no archived variant left) → no event noise.
    if (committed.event) {
      this.unitOfWork.addEvent(committed.event);
      await this.unitOfWork.publishEvents();
    }
    return { restoredAt: committed.restoredAt };
  }
}
