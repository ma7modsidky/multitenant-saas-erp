import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

/**
 * GetPurchaseOrderUseCase — one PO with its lines (PUR-8 snapshots) + supplier
 * snapshot. Read-only; RLS scopes every row to the org.
 */
@Injectable()
export class GetPurchaseOrderUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { purchaseOrderId: string }): Promise<{
    id: string;
    number: string;
    supplierId: string;
    supplierNameSnapshot: string;
    status: string;
    orderDate: string;
    expectedDate: string | null;
    currency: string;
    subtotalMinor: string;
    discountMinor: string;
    taxMinor: string;
    totalMinor: string;
    notes: string | null;
    createdAt: string;
    lines: Array<{
      id: string;
      variantId: string | null;
      itemNameSnapshot: string;
      quantity: string;
      receivedQuantity: string;
      unitCostMinor: string;
      unitCostCurrency: string;
      taxRateBpSnapshot: number;
      lineTotalMinor: string;
    }>;
  }> {
    return this.txManager.run(async (tx) => {
      const po = await this.repo.findPurchaseOrderById(input.purchaseOrderId, tx);
      if (!po) throw new NotFoundError('PURCHASING_PO_NOT_FOUND', { purchaseOrderId: input.purchaseOrderId });

      return {
        id: po.id,
        number: po.number,
        supplierId: po.supplierId,
        supplierNameSnapshot: po.supplierNameSnapshot,
        status: po.status,
        orderDate: po.orderDate,
        expectedDate: po.expectedDate,
        currency: po.currency,
        subtotalMinor: po.subtotalMinor,
        discountMinor: po.discountMinor,
        taxMinor: po.taxMinor,
        totalMinor: po.totalMinor,
        notes: po.notes,
        createdAt: po.createdAt,
        lines: po.lines.map((line) => ({
          id: line.id,
          variantId: line.variantId,
          itemNameSnapshot: line.itemNameSnapshot,
          quantity: line.quantity,
          receivedQuantity: line.receivedQuantity,
          unitCostMinor: line.unitCostMinor,
          unitCostCurrency: line.unitCostCurrency,
          taxRateBpSnapshot: line.taxRateBpSnapshot,
          lineTotalMinor: line.lineTotalMinor,
        })),
      };
    });
  }
}
