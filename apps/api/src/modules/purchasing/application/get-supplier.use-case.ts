import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

/**
 * GetSupplierUseCase — one supplier with its derived balance (PUR-2) and its
 * append-only vendor-ledger trail. Read-only; RLS scopes every row to the org.
 */
@Injectable()
export class GetSupplierUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { supplierId: string }): Promise<{
    supplier: {
      id: string;
      code: string;
      name: string;
      taxId: string | null;
      paymentTerms: { netDays: number; discountDays: number; discountRateBp: number };
      currency: string;
      contactName: string | null;
      contactEmail: string | null;
      contactPhone: string | null;
      isActive: boolean;
      createdAt: string;
    };
    /** PUR-2: the derived AP balance (signed sum of ledger entries). */
    balanceMinor: string;
    ledger: Array<{
      id: string;
      type: string;
      amountMinor: string;
      currency: string;
      referenceType: string;
      referenceNumber: string | null;
      entryDate: string;
      createdAt: string;
    }>;
  }> {
    return this.txManager.run(async (tx) => {
      const supplier = await this.repo.findSupplierById(input.supplierId, tx);
      if (!supplier) throw new NotFoundError('PURCHASING_SUPPLIER_NOT_FOUND', { supplierId: input.supplierId });

      const [balanceMinor, ledger] = await Promise.all([
        this.repo.sumSupplierBalance(input.supplierId, tx),
        this.repo.listLedgerEntries(input.supplierId, tx),
      ]);

      return {
        supplier: {
          id: supplier.id,
          code: supplier.code,
          name: supplier.name,
          taxId: supplier.taxId,
          paymentTerms: supplier.paymentTerms,
          currency: supplier.currency,
          contactName: supplier.contactName,
          contactEmail: supplier.contactEmail,
          contactPhone: supplier.contactPhone,
          isActive: supplier.isActive,
          createdAt: supplier.createdAt,
        },
        balanceMinor,
        ledger: ledger.map((entry) => ({
          id: entry.id,
          type: entry.type,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
          referenceType: entry.referenceType,
          referenceNumber: entry.referenceNumber,
          entryDate: entry.entryDate,
          createdAt: entry.createdAt,
        })),
      };
    });
  }
}
