import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

/**
 * GetSupplierReturnUseCase — one supplier return / debit note with its lines +
 * bill snapshot (PUR-11). Read-only; RLS scopes every row to the org.
 */
@Injectable()
export class GetSupplierReturnUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { returnId: string }): Promise<{
    id: string;
    number: string;
    supplierId: string;
    supplierNameSnapshot: string;
    billId: string | null;
    billNumber: string | null;
    reasonCode: string;
    status: string;
    amountMinor: string;
    currency: string;
    returnedAt: string | null;
    createdAt: string;
    lines: Array<{
      id: string;
      variantId: string | null;
      quantity: string;
      unitCostMinor: string;
      unitCostCurrency: string;
    }>;
  }> {
    return this.txManager.run(async (tx) => {
      const supplierReturn = await this.repo.findSupplierReturnById(input.returnId, tx);
      if (!supplierReturn) throw new NotFoundError('PURCHASING_RETURN_NOT_FOUND', { returnId: input.returnId });

      return {
        id: supplierReturn.id,
        number: supplierReturn.number,
        supplierId: supplierReturn.supplierId,
        supplierNameSnapshot: supplierReturn.supplierNameSnapshot,
        billId: supplierReturn.billId,
        billNumber: supplierReturn.billNumber,
        reasonCode: supplierReturn.reasonCode,
        status: supplierReturn.status,
        amountMinor: supplierReturn.amountMinor,
        currency: supplierReturn.currency,
        returnedAt: supplierReturn.returnedAt,
        createdAt: supplierReturn.createdAt,
        lines: supplierReturn.lines.map((line) => ({
          id: line.id,
          variantId: line.variantId,
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          unitCostCurrency: line.unitCostCurrency,
        })),
      };
    });
  }
}
