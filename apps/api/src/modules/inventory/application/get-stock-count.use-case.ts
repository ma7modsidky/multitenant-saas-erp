import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import { type StockCountLineRow, INVENTORY_REPOSITORY, type InventoryRepository } from './ports/index.js';

export interface StockCountDetail {
  id: string;
  warehouseId: string;
  warehouseName: string;
  status: 'draft' | 'applied';
  countedAt: string | null;
  countedBy: string | null;
  notes: string | null;
  lines: StockCountLineRow[];
  createdAt: string;
  updatedAt: string;
}

/**
 * GetStockCountUseCase — the stock-count detail view (INV-14).
 *
 * Returns the count with its lines enriched with variant names/SKUs and the
 * warehouse name, so the detail page renders without extra lookups.
 */
@Injectable()
export class GetStockCountUseCase {
  constructor(
    @Inject(INVENTORY_REPOSITORY)
    private readonly repo: InventoryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(id: string): Promise<StockCountDetail> {
    TenantContext.requireOrganizationId();
    return this.txManager.run(async (tx) => {
      const count = await this.repo.findStockCountById(id, tx);
      if (!count) throw new NotFoundError('STOCK_COUNT_NOT_FOUND', { id });

      const [lines, warehouses] = await Promise.all([
        this.repo.listStockCountLines(id, tx),
        this.repo.listWarehouses(tx),
      ]);
      const warehouse = warehouses.find((w) => w.id === count.warehouseId);

      return {
        id: count.id,
        warehouseId: count.warehouseId,
        warehouseName: warehouse?.name ?? '—',
        status: count.status,
        countedAt: count.countedAt?.toISOString() ?? null,
        countedBy: count.countedBy,
        notes: count.notes,
        lines,
        createdAt: count.createdAt.toISOString(),
        updatedAt: count.updatedAt.toISOString(),
      };
    });
  }
}
