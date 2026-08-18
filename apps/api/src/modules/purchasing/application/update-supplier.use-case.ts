import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Supplier, type PaymentTerms } from '../domain/index.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

export interface UpdateSupplierInput {
  supplierId: string;
  name?: string;
  taxId?: string | null;
  paymentTerms?: PaymentTerms;
  currency?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: Record<string, unknown> | null;
  bankAccount?: Record<string, unknown> | null;
  isActive?: boolean;
}

/**
 * UpdateSupplierUseCase — PUR-1: directory edits (name, tax id, payment terms,
 * contact details, currency, address). The tax id stays unique per org; the
 * supplier code is permanent.
 */
@Injectable()
export class UpdateSupplierUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: UpdateSupplierInput): Promise<{ supplierId: string }> {
    const now = new Date();
    await this.txManager.run(async (tx) => {
      const row = await this.repo.findSupplierById(input.supplierId, tx);
      if (!row) throw new NotFoundError('PURCHASING_SUPPLIER_NOT_FOUND', { supplierId: input.supplierId });

      // PUR-1: tax id unique per org when provided (excluding this supplier).
      if (input.taxId && input.taxId.trim() !== '') {
        const clash = await this.repo.findSupplierByTaxId(input.taxId.trim(), tx);
        if (clash && clash.id !== input.supplierId) {
          throw new ConflictError(
            'PURCHASING_SUPPLIER_TAX_ID_EXISTS',
            'A supplier with this tax id already exists (PUR-1).',
            {
              taxId: input.taxId,
            },
          );
        }
      }

      const supplier = Supplier.fromJSON({ ...row, paymentTerms: { ...row.paymentTerms } });
      supplier.update({ ...input, now });
      await this.repo.updateSupplier(input.supplierId, supplier.toJSON(), tx);
    });
    return { supplierId: input.supplierId };
  }
}
