import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { type SaleRow, POS_REPOSITORY, type PosRepository } from './ports/index.js';

/**
 * GetSaleUseCase — a single sale with its lines + payments (receipts / detail).
 */
@Injectable()
export class GetSaleUseCase {
  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(saleId: string): Promise<SaleRow> {
    return this.txManager.run(async (tx) => {
      const sale = await this.repo.findSaleById(saleId, tx);
      if (!sale) throw new NotFoundError('POS_SALE_NOT_FOUND', { saleId });
      return sale;
    });
  }
}
