import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository, type TaxRateRow } from './ports/index.js';

/**
 * ListTaxRatesUseCase — ACC-11: lists the org's active tax-rate catalog, the
 * resolution source for the centralized tax engine (POS, invoicing,
 * purchasing). Rates with `coaAccountId` resolved to the account code/name so
 * the UI can render the GL mapping.
 */
@Injectable()
export class ListTaxRatesUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(): Promise<
    Array<
      TaxRateRow & {
        coaAccountCode: string | null;
        coaAccountNameI18n: Record<string, string> | null;
      }
    >
  > {
    TenantContext.requireOrganizationId();
    return this.txManager.run(async (tx) => {
      const rates = await this.repo.listTaxRates(tx);
      if (rates.length === 0) return [];

      const accounts = await this.repo.listAccounts(tx);
      const byId = new Map(accounts.map((a) => [a.id, a]));

      return rates.map((rate) => {
        const account = rate.coaAccountId ? byId.get(rate.coaAccountId) : undefined;
        return {
          ...rate,
          coaAccountCode: account?.code ?? null,
          coaAccountNameI18n: account?.nameI18n ?? null,
        };
      });
    });
  }
}
