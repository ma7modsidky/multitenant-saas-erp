import { INVENTORY_EVENTS, type InventoryProductCreatedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ProductVariant } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

export interface AddVariantInput {
  productId: string;
  sku: string;
  barcode?: string | null;
  priceAmountMinor: string;
  priceCurrency: string;
  costAmountMinor: string;
  costCurrency: string;
  reorderPoint: string;
  reorderQuantity: string;
}

/**
 * AddVariantUseCase — adds a sellable variant under an EXISTING product.
 *
 * Business rules:
 * - INV-10: SKU is unique per organization among non-deleted variants.
 * - INV-11: the product keeps its history; only the new variant row is added.
 *
 * Emits `inventory.product.created.v1` (a new sellable unit was created) after
 * commit.
 */
@Injectable()
export class AddVariantUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: AddVariantInput): Promise<{ variantId: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const variant = ProductVariant.create({
      id: crypto.randomUUID(),
      organizationId,
      productId: input.productId,
      sku: input.sku,
      barcode: input.barcode ?? null,
      attributes: {},
      priceAmountMinor: input.priceAmountMinor,
      priceCurrency: input.priceCurrency,
      costAmountMinor: input.costAmountMinor,
      costCurrency: input.costCurrency,
      reorderPoint: input.reorderPoint,
      reorderQuantity: input.reorderQuantity,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    const committed = await this.txManager.run(async (tx) => {
      const product = await this.repo.findProductById(input.productId, tx);
      if (!product) throw new NotFoundError('PRODUCT_NOT_FOUND', { productId: input.productId });

      // INV-10: reject a duplicate SKU within the org (case-insensitive).
      const existing = await this.repo.findVariantBySku(variant.sku, tx);
      if (existing) {
        variant.assertSkuUniqueIn(new Set([existing.sku.trim().toLowerCase()]));
      }

      const persisted = await this.repo.insertVariantForProduct(variant.toJSON(), tx);

      const payload: InventoryProductCreatedV1 = {
        organizationId,
        productId: persisted.productId,
        nameI18n: product.nameI18n,
        variantId: persisted.id,
        sku: persisted.sku,
        isActive: persisted.isActive,
        occurredAt: now.toISOString(),
      };
      const event = {
        name: INVENTORY_EVENTS.PRODUCT_CREATED_V1,
        payload,
        aggregateId: persisted.id,
      } satisfies Parameters<UnitOfWork['addEvent']>[0];

      return { variantId: persisted.id, event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return { variantId: committed.variantId };
  }
}
