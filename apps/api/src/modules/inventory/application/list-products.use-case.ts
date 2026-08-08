import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import {
  INVENTORY_REPOSITORY,
  type InventoryRepository,
  type PageResult,
  type ProductListFilter,
  type ProductWithVariantRow,
} from './ports/index.js';

/**
 * ListProductsUseCase — the products table view (product + first active variant).
 */
@Injectable()
export class ListProductsUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: ProductListFilter = {}): Promise<PageResult<ProductWithVariantRow>> {
    TenantContext.requireOrganizationId();
    return this.txManager.run((tx) => this.repo.listProducts(filter, tx));
  }
}
