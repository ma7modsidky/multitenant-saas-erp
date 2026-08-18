import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

/**
 * GetBillUseCase — one bill with its lines + supplier snapshot. Read-only;
 * RLS scopes every row to the org.
 */
@Injectable()
export class GetBillUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { billId: string }): Promise<{
    id: string;
    number: string;
    supplierId: string;
    supplierNameSnapshot: string;
    poId: string | null;
    grnId: string | null;
    status: string;
    billDate: string;
    dueDate: string | null;
    currency: string;
    subtotalMinor: string;
    discountMinor: string;
    taxMinor: string;
    totalMinor: string;
    paidMinor: string;
    supplierTaxIdSnapshot: string | null;
    createdAt: string;
    lines: Array<{
      id: string;
      poLineId: string | null;
      grnLineId: string | null;
      variantId: string | null;
      itemNameSnapshot: string;
      quantity: string;
      unitCostMinor: string;
      unitCostCurrency: string;
      taxRateBpSnapshot: number;
      taxMinor: string;
      lineTotalMinor: string;
    }>;
  }> {
    return this.txManager.run(async (tx) => {
      const bill = await this.repo.findBillById(input.billId, tx);
      if (!bill) throw new NotFoundError('PURCHASING_BILL_NOT_FOUND', { billId: input.billId });

      return {
        id: bill.id,
        number: bill.number,
        supplierId: bill.supplierId,
        supplierNameSnapshot: bill.supplierNameSnapshot,
        poId: bill.poId,
        grnId: bill.grnId,
        status: bill.status,
        billDate: bill.billDate,
        dueDate: bill.dueDate,
        currency: bill.currency,
        subtotalMinor: bill.subtotalMinor,
        discountMinor: bill.discountMinor,
        taxMinor: bill.taxMinor,
        totalMinor: bill.totalMinor,
        paidMinor: bill.paidMinor,
        supplierTaxIdSnapshot: bill.supplierTaxIdSnapshot,
        createdAt: bill.createdAt,
        lines: bill.lines.map((line) => ({
          id: line.id,
          poLineId: line.poLineId,
          grnLineId: line.grnLineId,
          variantId: line.variantId,
          itemNameSnapshot: line.itemNameSnapshot,
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          unitCostCurrency: line.unitCostCurrency,
          taxRateBpSnapshot: line.taxRateBpSnapshot,
          taxMinor: line.taxMinor,
          lineTotalMinor: line.lineTotalMinor,
        })),
      };
    });
  }
}
