import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { type ProductVariantData } from '../domain/index.js';

import { type MovementRow, type StockLevelRow, INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

/** One variant with its per-warehouse stock rows attached. */
export interface ProductVariantWithStock extends ProductVariantData {
  stock: StockLevelRow[];
}

export interface GetProductResult {
  product: {
    id: string;
    nameI18n: Record<string, string>;
    descriptionI18n: Record<string, string>;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    createdByUserId: string | null;
    updatedByUserId: string | null;
  };
  variants: ProductVariantWithStock[];
  /** Movement history across all of the product's variants (INV-1, newest first). */
  movements: MovementRow[];
}

/**
 * GetProductUseCase — the product detail read (product + variants + stock).
 *
 * Composes three tenant-scoped reads into one response so the detail page has
 * everything in a single round trip: the product row, every variant (archived
 * included — INV-11 history never disappears), each variant's per-warehouse
 * stock projection, and the product's movement ledger.
 */
@Injectable()
export class GetProductUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(productId: string): Promise<GetProductResult> {
    TenantContext.requireOrganizationId();
    return this.txManager.run(async (tx) => {
      const product = await this.repo.findProductById(productId, tx);
      if (!product) throw new NotFoundError('PRODUCT_NOT_FOUND', { productId });

      const variants = await this.repo.listVariantsByProduct(productId, tx);
      // Internal composition reads: fetch every matching row — pagination is
      // for the list endpoints, and truncating a detail view would hide history.
      const [stockPage, movementPage] = await Promise.all([
        this.repo.listStockLevels({ all: true }, tx),
        this.repo.listMovements({ all: true }, tx),
      ]);
      const allStock = stockPage.items;
      const allMovements = movementPage.items;

      const variantIds = new Set(variants.map((variant) => variant.id));
      const stockByVariant = new Map<string, StockLevelRow[]>();
      for (const row of allStock) {
        if (!variantIds.has(row.variantId)) continue;
        const list = stockByVariant.get(row.variantId) ?? [];
        list.push(row);
        stockByVariant.set(row.variantId, list);
      }

      return {
        product: {
          id: product.id,
          nameI18n: product.nameI18n,
          descriptionI18n: product.descriptionI18n,
          isActive: product.isActive,
          createdAt: product.createdAt.toISOString(),
          updatedAt: product.updatedAt.toISOString(),
          createdByUserId: product.createdByUserId,
          updatedByUserId: product.updatedByUserId,
        },
        variants: variants.map((variant) => ({
          ...variant,
          stock: stockByVariant.get(variant.id) ?? [],
        })),
        movements: allMovements.filter((movement) => variantIds.has(movement.variantId)),
      };
    });
  }
}
