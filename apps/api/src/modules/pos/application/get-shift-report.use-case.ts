import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { parseMinor } from '../domain/index.js';

import { type RefundRow, type SaleRow, type ShiftRow, POS_REPOSITORY, type PosRepository } from './ports/index.js';

export interface ShiftReport {
  shift: ShiftRow;
  sales: SaleRow[];
  refunds: RefundRow[];
  totals: {
    /** Σ sale totals in the shift. */
    salesAmountMinor: string;
    /** Σ refund amounts in the shift. */
    refundsAmountMinor: string;
    /** sales − refunds. */
    netAmountMinor: string;
  };
}

/**
 * GetShiftReportUseCase — the shift close report (POS-8: business-day
 * boundaries follow the organization's timezone at the client; amounts here
 * are exact minor-unit sums).
 */
@Injectable()
export class GetShiftReportUseCase {
  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(shiftId: string): Promise<ShiftReport> {
    return this.txManager.run(async (tx) => {
      const shift = await this.repo.findShiftById(shiftId, tx);
      if (!shift) throw new NotFoundError('POS_SHIFT_NOT_FOUND', { shiftId });

      const sales = await this.repo.listSalesByShift(shiftId, tx);
      const refunds = await this.repo.listRefundsByShift(shiftId, tx);

      const salesAmount = sales.reduce((acc, sale) => acc + parseMinor(sale.totalAmountMinor), 0n);
      const refundsAmount = refunds.reduce((acc, refund) => acc + parseMinor(refund.amountMinor), 0n);

      return {
        shift,
        sales,
        refunds,
        totals: {
          salesAmountMinor: salesAmount.toString(),
          refundsAmountMinor: refundsAmount.toString(),
          netAmountMinor: (salesAmount - refundsAmount).toString(),
        },
      };
    });
  }
}
