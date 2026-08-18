import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

/**
 * GetPaymentUseCase — one cash disbursement with its allocation breakdown
 * across bills (PUR-7). Read-only; RLS scopes every row to the org.
 */
@Injectable()
export class GetPaymentUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { paymentId: string }): Promise<{
    id: string;
    number: string;
    supplierId: string;
    supplierNameSnapshot: string;
    method: string;
    amountMinor: string;
    currency: string;
    paidAt: string;
    reference: string | null;
    createdAt: string;
    allocations: Array<{
      id: string;
      billId: string;
      billNumber: string;
      amountMinor: string;
      currency: string;
    }>;
  }> {
    return this.txManager.run(async (tx) => {
      const payment = await this.repo.getPaymentDetail(input.paymentId, tx);
      if (!payment) throw new NotFoundError('PURCHASING_PAYMENT_NOT_FOUND', { paymentId: input.paymentId });

      return {
        id: payment.id,
        number: payment.number,
        supplierId: payment.supplierId,
        supplierNameSnapshot: payment.supplierNameSnapshot,
        method: payment.method,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        paidAt: payment.paidAt,
        reference: payment.reference,
        createdAt: payment.createdAt,
        allocations: payment.allocations,
      };
    });
  }
}
