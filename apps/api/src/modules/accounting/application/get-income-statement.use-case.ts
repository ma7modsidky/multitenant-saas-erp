import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

/** One income-statement line — a revenue or expense account's period net. */
export interface IncomeStatementLine {
  accountId: string;
  code: string;
  nameI18n: Record<string, string>;
  /** Period net in the natural direction (credit for revenue, debit for expense). */
  netMinor: string;
}

/**
 * GetIncomeStatementUseCase — revenue minus expenses for a period (all-time
 * when no range is given). Revenue accounts are credit-normal, expense
 * accounts debit-normal; the net in the natural direction is summed per
 * category. Net income = revenue − expenses (minor units).
 *
 * Read-only; RLS scopes every row to the org (TEN-1).
 */
@Injectable()
export class GetIncomeStatementUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: { fromDate?: string; toDate?: string } = {}): Promise<{
    revenue: IncomeStatementLine[];
    expenses: IncomeStatementLine[];
    revenueTotalMinor: string;
    expenseTotalMinor: string;
    netIncomeMinor: string;
  }> {
    TenantContext.requireOrganizationId();

    return this.txManager.run(async (tx) => {
      const rows = await this.repo.sumAccountPeriodBalances(filter, tx);

      let revenueTotal = 0n;
      let expenseTotal = 0n;
      const revenue: IncomeStatementLine[] = [];
      const expenses: IncomeStatementLine[] = [];

      for (const row of rows) {
        const debit = BigInt(row.debitTotalMinor);
        const credit = BigInt(row.creditTotalMinor);
        if (row.type === 'revenue') {
          const net = credit - debit; // credit-normal
          if (net > 0n) {
            revenueTotal += net;
            revenue.push({ accountId: row.id, code: row.code, nameI18n: row.nameI18n, netMinor: net.toString() });
          }
        } else if (row.type === 'expense') {
          const net = debit - credit; // debit-normal
          if (net > 0n) {
            expenseTotal += net;
            expenses.push({ accountId: row.id, code: row.code, nameI18n: row.nameI18n, netMinor: net.toString() });
          }
        }
      }

      return {
        revenue,
        expenses,
        revenueTotalMinor: revenueTotal.toString(),
        expenseTotalMinor: expenseTotal.toString(),
        netIncomeMinor: (revenueTotal - expenseTotal).toString(),
      };
    });
  }
}
