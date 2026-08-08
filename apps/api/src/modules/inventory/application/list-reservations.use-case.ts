import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import {
  INVENTORY_REPOSITORY,
  type InventoryRepository,
  type PageResult,
  type ReservationListFilter,
  type ReservationRow,
} from './ports/index.js';

/** ListReservationsUseCase — the reservations view (INV-7/8). */
@Injectable()
export class ListReservationsUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: ReservationListFilter = {}): Promise<PageResult<ReservationRow>> {
    TenantContext.requireOrganizationId();
    return this.txManager.run((tx) => this.repo.listReservations(filter, tx));
  }
}
