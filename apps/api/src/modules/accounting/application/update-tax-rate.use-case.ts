import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { TaxRate, type TaxBasis, type TaxType } from '../domain/index.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

export interface UpdateTaxRateInput {
  taxRateId: string;
  nameI18n?: Record<string, string>;
  rateBp?: number;
  type?: TaxType;
  taxBasis?: TaxBasis;
  /** undefined keeps the current mapping; null clears it back to the fallback. */
  coaAccountId?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}

/**
 * UpdateTaxRateUseCase — ACC-11: updates a tax rate's attributes. Promoting a
 * rate to default demotes the previous default atomically (exactly one default
 * per org). The code — the catalog identity — never changes.
 */
@Injectable()
export class UpdateTaxRateUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: UpdateTaxRateInput): Promise<{ taxRateId: string }> {
    TenantContext.requireOrganizationId();

    return this.txManager.run(async (tx) => {
      const row = await this.repo.findTaxRateById(input.taxRateId, tx);
      if (!row) {
        throw new NotFoundError('ACCOUNTING_TAX_RATE_NOT_FOUND', { taxRateId: input.taxRateId });
      }

      // ACC-11: promoting to default demotes the previous default atomically.
      if (input.isDefault === true) {
        const current = await this.repo.getDefaultTaxRate(tx);
        if (current && current.id !== input.taxRateId) {
          await this.repo.updateTaxRate(current.id, { isDefault: false }, tx);
        }
      }

      const rate = TaxRate.fromPersistence({
        id: row.id,
        organizationId: row.organizationId,
        code: row.code,
        nameI18n: row.nameI18n,
        rateBp: row.rateBp,
        type: row.type as TaxType,
        taxBasis: row.taxBasis as TaxBasis,
        coaAccountId: row.coaAccountId,
        isDefault: row.isDefault,
        effectiveFrom: row.effectiveFrom,
        isActive: row.isActive,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      rate.update(
        {
          ...(input.nameI18n !== undefined ? { nameI18n: input.nameI18n } : {}),
          ...(input.rateBp !== undefined ? { rateBp: input.rateBp } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.taxBasis !== undefined ? { taxBasis: input.taxBasis } : {}),
          ...(input.coaAccountId !== undefined ? { coaAccountId: input.coaAccountId } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        new Date(),
      );

      await this.repo.updateTaxRate(input.taxRateId, rate.toJSON(), tx);
      return { taxRateId: input.taxRateId };
    });
  }
}
