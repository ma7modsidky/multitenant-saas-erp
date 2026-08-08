import { INVENTORY_EVENTS, type InventoryProductRestoredV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ProductVariant } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

/**
 * UnarchiveVariantUseCase — restores ONE archived variant (INV-11 inverse):
 * `is_active = true` and the soft delete is lifted, so the variant is sellable
 * again while its movement history stays the source of truth.
 *
 * INV-10 edge case: while a variant was archived its SKU was free — another
 * variant may have claimed it. Restoring is rejected with the duplicate-SKU
 * error when that happened, keeping the org-wide uniqueness invariant.
 *
 * Emits `inventory.product.restored.v1` after commit with just this variant.
 */
@Injectable()
export class UnarchiveVariantUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(variantId: string): Promise<{ restoredAt: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      // The archived row is excluded from findVariantById — read it without
      // the deleted_at filter so it can be restored.
      const row = await this.repo.findVariantByIdIncludingDeleted(variantId, tx);
      if (!row) throw new NotFoundError('VARIANT_NOT_FOUND', { variantId });

      const variant = ProductVariant.fromPersistence(row);
      variant.unarchive(userId ?? 'system', now);

      // INV-10: only check uniqueness when restoring — an archived SKU may
      // have been claimed by a newer variant while it was unavailable.
      const existing = await this.repo.findVariantBySku(variant.sku, tx);
      if (existing && existing.id !== variantId) {
        variant.assertSkuUniqueIn(new Set([existing.sku.trim().toLowerCase()]));
      }

      await this.repo.unarchiveVariant(variantId, now, userId, tx);

      const payload: InventoryProductRestoredV1 = {
        organizationId,
        productId: variant.productId,
        variantIds: [variantId],
        restoredAt: now.toISOString(),
        occurredAt: now.toISOString(),
      };
      const event = {
        name: INVENTORY_EVENTS.PRODUCT_RESTORED_V1,
        payload,
        aggregateId: variantId,
      } satisfies Parameters<UnitOfWork['addEvent']>[0];

      return { restoredAt: now.toISOString(), event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return { restoredAt: committed.restoredAt };
  }
}
