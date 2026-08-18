import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

/**
 * GetVendorBalancesUseCase — every supplier with its derived AP balance
 * (PUR-2: the signed sum of the vendor-ledger entries — always derived, never
 * a stored, editable number). The vendor-ledger view is append-only; there is
 * nothing to edit or delete here.
 */
@Injectable()
export class GetVendorBalancesUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(): Promise<{
    suppliers: Array<{
      id: string;
      code: string;
      name: string;
      currency: string;
      /** PUR-2: signed sum of the supplier's ledger entries. */
      balanceMinor: string;
    }>;
    /** Σ of all supplier balances (net AP). */
    totalBalanceMinor: string;
  }> {
    return this.txManager.run(async (tx) => {
      const suppliers = await this.repo.listAllSuppliers(tx);
      const rows = await Promise.all(
        suppliers.map(async (supplier) => ({
          id: supplier.id,
          code: supplier.code,
          name: supplier.name,
          currency: supplier.currency,
          balanceMinor: await this.repo.sumSupplierBalance(supplier.id, tx),
        })),
      );
      return {
        suppliers: rows,
        totalBalanceMinor: rows.reduce((sum, row) => sum + BigInt(row.balanceMinor), 0n).toString(),
      };
    });
  }
}
