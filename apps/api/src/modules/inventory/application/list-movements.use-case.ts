import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import {
  INVENTORY_REPOSITORY,
  type InventoryRepository,
  type MovementListFilter,
  type MovementRow,
  type PageResult,
} from './ports/index.js';

/** ListMovementsUseCase — the append-only stock ledger, newest first (INV-1). */
@Injectable()
export class ListMovementsUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: MovementListFilter = {}): Promise<PageResult<MovementRow>> {
    TenantContext.requireOrganizationId();
    return this.txManager.run((tx) => this.repo.listMovements(filter, tx));
  }
}
