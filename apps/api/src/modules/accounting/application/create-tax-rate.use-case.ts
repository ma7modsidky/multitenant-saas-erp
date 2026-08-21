import { Inject, Injectable } from '@nestjs/common';

import { ConflictError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { TaxRate, type TaxBasis, type TaxType } from '../domain/index.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

export interface CreateTaxRateInput {
  /** Unique per org (partial unique index on (org, code)). */
  code: string;
  nameI18n: Record<string, string>;
  /** ACC-11: rate in basis points (1% = 100 bp). */
  rateBp: number;
  type?: TaxType;
  /** ACC-11: exclusive (default) or inclusive. */
  taxBasis?: TaxBasis;
  /** GL account absorbing this rate's tax; NULL = seeded VAT fallback. */
  coaAccountId?: string | null;
  /** At most one default rate per org. */
  isDefault?: boolean;
  effectiveFrom?: string;
}

/**
 * CreateTaxRateUseCase — ACC-11: adds a tax rate to the org's catalog. The
 * catalog is the single source the tax engine resolves rates from; invoices
 * and POS lines snapshot the rate at document time.
 */
@Injectable()
export class CreateTaxRateUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: CreateTaxRateInput): Promise<{ taxRateId: string; code: string }> {
    const organizationId = TenantContext.requireOrganizationId();

    return this.txManager.run(async (tx) => {
      const code = input.code.trim();

      // ACC-11: tax-rate codes are unique per org.
      const existing = await this.repo.listTaxRates(tx);
      if (existing.some((r) => r.code === code)) {
        throw new ConflictError('ACCOUNTING_TAX_CODE_EXISTS', `Tax rate code ${code} already exists.`, { code });
      }

      // ACC-11: promoting a rate to default demotes the previous default
      // atomically (the partial unique index enforces exactly one default).
      const makeDefault = input.isDefault ?? false;
      if (makeDefault) {
        const current = await this.repo.getDefaultTaxRate(tx);
        if (current && current.id !== undefined) {
          await this.repo.updateTaxRate(current.id, { isDefault: false }, tx);
        }
      }

      const rate = TaxRate.create({
        id: crypto.randomUUID(),
        organizationId,
        code,
        nameI18n: input.nameI18n,
        rateBp: input.rateBp,
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.taxBasis !== undefined ? { taxBasis: input.taxBasis } : {}),
        ...(input.coaAccountId !== undefined && input.coaAccountId !== null
          ? { coaAccountId: input.coaAccountId }
          : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        ...(input.effectiveFrom !== undefined ? { effectiveFrom: input.effectiveFrom } : {}),
      });

      await this.repo.insertTaxRate(rate.toJSON(), tx);
      return { taxRateId: rate.id, code: rate.toJSON().code };
    });
  }
}
