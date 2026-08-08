import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import {
  INVENTORY_REPOSITORY,
  type InventoryRepository,
  type PageResult,
  type VariantListFilter,
  type VariantListRow,
} from './ports/index.js';

/**
 * ListVariantsUseCase — every sellable variant org-wide (variant pickers).
 *
 * Unlike the products list (one display variant per product), this returns a
 * row for EACH variant so receive/adjust/transfer/count forms can target the
 * exact unit — a product with multiple variants shows all of them.
 */
@Injectable()
export class ListVariantsUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: VariantListFilter = {}): Promise<PageResult<VariantListRow>> {
    TenantContext.requireOrganizationId();
    return this.txManager.run((tx) => this.repo.listVariants(filter, tx));
  }
}
