import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

/** One balance-sheet line — an account's balance in its natural direction. */
export interface BalanceSheetLine {
  accountId: string;
  code: string;
  nameI18n: Record<string, string>;
  /** Balance as of the report date, in the account's natural direction. */
  balanceMinor: string;
}

/**
 * GetBalanceSheetUseCase — the balance sheet as of a date (default: today):
 * assets (debit-normal), liabilities and equity (credit-normal), each with
 * its natural-direction balance and section totals. Read-only; RLS scopes
 * every row to the org.
 */
@Injectable()
export class GetBalanceSheetUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { asOfDate?: string } = {}): Promise<{
    asOfDate: string;
    assets: BalanceSheetLine[];
    liabilities: BalanceSheetLine[];
    equity: BalanceSheetLine[];
    assetTotalMinor: string;
    liabilityTotalMinor: string;
    equityTotalMinor: string;
  }> {
    TenantContext.requireOrganizationId();

    const asOfDate = input.asOfDate ?? new Date().toISOString().slice(0, 10);

    return this.txManager.run(async (tx) => {
      // Balance sheet is a point-in-time snapshot: include every line up to
      // and including the report date.
      const rows = await this.repo.sumAccountPeriodBalances({ toDate: asOfDate }, tx);

      let assetTotal = 0n;
      let liabilityTotal = 0n;
      let equityTotal = 0n;
      const assets: BalanceSheetLine[] = [];
      const liabilities: BalanceSheetLine[] = [];
      const equity: BalanceSheetLine[] = [];

      for (const row of rows) {
        const debit = BigInt(row.debitTotalMinor);
        const credit = BigInt(row.creditTotalMinor);
        if (row.type === 'asset') {
          const net = debit - credit;
          if (net !== 0n) {
            assetTotal += net;
            assets.push({ accountId: row.id, code: row.code, nameI18n: row.nameI18n, balanceMinor: net.toString() });
          }
        } else if (row.type === 'liability') {
          const net = credit - debit;
          if (net !== 0n) {
            liabilityTotal += net;
            liabilities.push({
              accountId: row.id,
              code: row.code,
              nameI18n: row.nameI18n,
              balanceMinor: net.toString(),
            });
          }
        } else if (row.type === 'equity') {
          const net = credit - debit;
          if (net !== 0n) {
            equityTotal += net;
            equity.push({ accountId: row.id, code: row.code, nameI18n: row.nameI18n, balanceMinor: net.toString() });
          }
        }
      }

      return {
        asOfDate,
        assets,
        liabilities,
        equity,
        assetTotalMinor: assetTotal.toString(),
        liabilityTotalMinor: liabilityTotal.toString(),
        equityTotalMinor: equityTotal.toString(),
      };
    });
  }
}
