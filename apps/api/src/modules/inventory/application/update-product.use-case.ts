import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

export interface UpdateProductInput {
  nameI18n?: Record<string, string>;
  descriptionI18n?: Record<string, string>;
}

/**
 * UpdateProductUseCase — edits the product's translatable catalog metadata
 * (`name_i18n` / `description_i18n`).
 *
 * Catalog-only: the ledger, variants, and stock projections are untouched.
 * Archived products keep their history and can still be renamed through the
 * API. The UI currently gates the edit entry points to active products (its
 * edit form also touches the primary variant, which is not sellable once
 * archived); rename-only flows can target this use case directly. Pricing and
 * stock fields belong to variants (UpdateVariantUseCase).
 */
@Injectable()
export class UpdateProductUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(productId: string, input: UpdateProductInput): Promise<{ productId: string; updatedAt: string }> {
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    await this.txManager.run(async (tx) => {
      const product = await this.repo.findProductById(productId, tx);
      if (!product) throw new NotFoundError('PRODUCT_NOT_FOUND', { productId });

      await this.repo.updateProduct(
        productId,
        {
          ...(input.nameI18n !== undefined ? { nameI18n: input.nameI18n } : {}),
          ...(input.descriptionI18n !== undefined ? { descriptionI18n: input.descriptionI18n } : {}),
        },
        now,
        userId,
        tx,
      );
    });

    return { productId, updatedAt: now.toISOString() };
  }
}
