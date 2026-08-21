import { INVENTORY_EVENTS, type InventoryProductCreatedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ProductVariant } from '../domain/index.js';

import { INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

export interface CreateProductInput {
  nameI18n: Record<string, string>;
  sku: string;
  barcode?: string | null;
  priceAmountMinor: string;
  priceCurrency: string;
  costAmountMinor: string;
  costCurrency: string;
  reorderPoint: string;
  reorderQuantity: string;
  /** ACC-11: product-level tax rate in basis points (default 0). */
  taxRateBp?: number;
}

/**
 * CreateProductUseCase — creates a product template with its first variant.
 *
 * Business rules:
 * - INV-10: SKU is unique per organization among non-deleted variants.
 * - Every product starts with exactly one variant (sellable unit).
 *
 * Collects `inventory.product.created.v1`; publishes after commit.
 */
@Injectable()
export class CreateProductUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: CreateProductInput): Promise<{ productId: string; variantId: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const variant = ProductVariant.create({
      id: crypto.randomUUID(),
      organizationId,
      productId: crypto.randomUUID(),
      sku: input.sku,
      barcode: input.barcode ?? null,
      attributes: {},
      priceAmountMinor: input.priceAmountMinor,
      priceCurrency: input.priceCurrency,
      costAmountMinor: input.costAmountMinor,
      costCurrency: input.costCurrency,
      reorderPoint: input.reorderPoint,
      reorderQuantity: input.reorderQuantity,
      taxRateBp: input.taxRateBp ?? 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    const committed = await this.txManager.run(async (tx) => {
      // INV-10: reject a duplicate SKU within the org. The domain guard
      // compares normalized (lowercase) SKUs, so the set must carry the
      // existing variant's SKU normalized too.
      const existing = await this.repo.findVariantBySku(variant.sku, tx);
      if (existing) {
        variant.assertSkuUniqueIn(new Set([existing.sku.trim().toLowerCase()]));
      }

      const persisted = await this.repo.insertVariant(variant.toJSON(), input.nameI18n, tx);

      const payload: InventoryProductCreatedV1 = {
        organizationId,
        productId: persisted.productId,
        nameI18n: input.nameI18n,
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

      return { productId: persisted.productId, variantId: persisted.id, event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return { productId: committed.productId, variantId: committed.variantId };
  }
}
