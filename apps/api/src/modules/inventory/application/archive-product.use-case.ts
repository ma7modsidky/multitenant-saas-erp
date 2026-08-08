import { INVENTORY_EVENTS, type InventoryProductArchivedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ProductVariant } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

/**
 * ArchiveProductUseCase — archives a PRODUCT (INV-11): every non-deleted
 * variant is soft-deleted (`is_active = false` + `deleted_at`), so the product
 * stops being sellable while its movement history stays the source of truth.
 *
 * The product list archive action sends the PRODUCT id — a variant with any
 * history can never be hard-deleted, only archived, and the product's
 * `is_active` is derived from its variants, so archiving must cover all of
 * them. Single-variant archiving lives in ArchiveVariantUseCase.
 *
 * Emits one `inventory.product.archived.v1` carrying every archived variant id
 * after commit.
 */
@Injectable()
export class ArchiveProductUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(productId: string): Promise<{ archivedAt: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      const product = await this.repo.findProductById(productId, tx);
      if (!product) throw new NotFoundError('PRODUCT_NOT_FOUND', { productId });

      const variants = await this.repo.listVariantsByProduct(productId, tx);
      // Already-archived variants are left untouched (their history is intact);
      // only sellable variants flip to archived now.
      const variantIds = variants.filter((row) => row.deletedAt === null).map((row) => row.id);

      for (const row of variants) {
        if (row.deletedAt !== null) continue;
        const variant = ProductVariant.fromPersistence(row);
        variant.archive(userId ?? 'system', now);
        await this.repo.archiveVariant(variant.id, now, userId, tx);
      }

      const payload: InventoryProductArchivedV1 = {
        organizationId,
        productId,
        variantIds,
        archivedAt: now.toISOString(),
        occurredAt: now.toISOString(),
      };
      const event =
        variantIds.length > 0
          ? ({
              name: INVENTORY_EVENTS.PRODUCT_ARCHIVED_V1,
              payload,
              aggregateId: productId,
            } satisfies Parameters<UnitOfWork['addEvent']>[0])
          : null;

      return { archivedAt: now.toISOString(), event };
    });

    // Nothing changed (no sellable variant left) → no event noise.
    if (committed.event) {
      this.unitOfWork.addEvent(committed.event);
      await this.unitOfWork.publishEvents();
    }
    return { archivedAt: committed.archivedAt };
  }
}
