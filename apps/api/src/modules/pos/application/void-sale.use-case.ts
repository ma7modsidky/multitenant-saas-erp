import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { PosError, POS_ERROR_CODE, Sale } from '../domain/index.js';

import { POS_REPOSITORY, type PosRepository } from './ports/index.js';

/**
 * VoidSaleUseCase — voids a sale (POS-14).
 *
 * Business rules:
 * - POS-13: a completed sale is immutable — corrections are refunds or voids,
 *   never edits.
 * - POS-14: a sale may be voided only within the SAME open shift and only if
 *   no payment has been captured; afterwards, only a refund is possible.
 */
@Injectable()
export class VoidSaleUseCase {
  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(saleId: string): Promise<{ saleId: string; status: string }> {
    return this.txManager.run(async (tx) => {
      const row = await this.repo.findSaleById(saleId, tx);
      if (!row) throw new NotFoundError('POS_SALE_NOT_FOUND', { saleId });

      const sale = Sale.fromPersistence(row);

      // POS-14: void requires the SAME open shift.
      const openShift = await this.repo.findOpenShiftByRegister(row.registerId, tx);
      if (!openShift) {
        throw new PosError(
          POS_ERROR_CODE.SALE_NOT_VOIDABLE,
          'A sale can only be voided within the same open shift (POS-14).',
          { saleId },
        );
      }

      sale.assertCanVoid(openShift.id);
      sale.markVoided(new Date());

      await this.repo.updateSaleStatus(sale.id, sale.status, tx);
      return { saleId: sale.id, status: sale.status };
    });
  }
}
