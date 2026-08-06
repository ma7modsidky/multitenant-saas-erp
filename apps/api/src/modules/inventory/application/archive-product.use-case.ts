import { INVENTORY_EVENTS, type InventoryProductArchivedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ProductVariant } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

/**
 * ArchiveProductUseCase — INV-11: a variant with any stock movement history
 * cannot be hard-deleted, only archived (`is_active = false` + soft delete).
 * The variant's historical movements remain the source of truth.
 */
@Injectable()
export class ArchiveProductUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(variantId: string): Promise<{ archivedAt: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      const row = await this.repo.findVariantById(variantId, tx);
      if (!row) throw new NotFoundError('VARIANT_NOT_FOUND', { variantId });

      const variant = ProductVariant.fromPersistence(row);

      // INV-11: history never disappears. If there is any ledger history the
      // variant may only be archived — a hard delete is rejected by the
      // repository; here we always archive (safe for both cases).
      variant.archive(userId ?? 'system', now);
      await this.repo.archiveVariant(variantId, now, userId, tx);

      const payload: InventoryProductArchivedV1 = {
        organizationId,
        productId: variant.productId,
        variantIds: [variantId],
        archivedAt: now.toISOString(),
        occurredAt: now.toISOString(),
      };
      const event = {
        name: INVENTORY_EVENTS.PRODUCT_ARCHIVED_V1,
        payload,
        aggregateId: variantId,
      } satisfies Parameters<UnitOfWork['addEvent']>[0];

      return { archivedAt: now.toISOString(), event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return { archivedAt: committed.archivedAt };
  }
}
