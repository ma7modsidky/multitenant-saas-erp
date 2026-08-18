import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

/**
 * GetGrnUseCase — one GRN with its lines + PO/supplier snapshots. Read-only;
 * a received GRN is immutable (PUR-5).
 */
@Injectable()
export class GetGrnUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { grnId: string }): Promise<{
    id: string;
    number: string;
    poId: string;
    poNumber: string;
    supplierId: string;
    supplierNameSnapshot: string;
    warehouseId: string | null;
    status: string;
    receivedAt: string | null;
    receivedBy: string | null;
    createdAt: string;
    lines: Array<{
      id: string;
      poLineId: string;
      variantId: string | null;
      quantity: string;
      unitCostMinor: string;
      unitCostCurrency: string;
      accepted: boolean;
    }>;
  }> {
    return this.txManager.run(async (tx) => {
      const grn = await this.repo.findGrnById(input.grnId, tx);
      if (!grn) throw new NotFoundError('PURCHASING_GRN_NOT_FOUND', { grnId: input.grnId });

      return {
        id: grn.id,
        number: grn.number,
        poId: grn.poId,
        poNumber: grn.poNumber,
        supplierId: grn.supplierId,
        supplierNameSnapshot: grn.supplierNameSnapshot,
        warehouseId: grn.warehouseId,
        status: grn.status,
        receivedAt: grn.receivedAt,
        receivedBy: grn.receivedBy,
        createdAt: grn.createdAt,
        lines: grn.lines.map((line) => ({
          id: line.id,
          poLineId: line.poLineId,
          variantId: line.variantId,
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          unitCostCurrency: line.unitCostCurrency,
          accepted: line.accepted,
        })),
      };
    });
  }
}
