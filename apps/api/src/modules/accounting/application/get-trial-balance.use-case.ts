import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

/** One trial-balance row — raw debit/credit totals plus the natural balance. */
export interface TrialBalanceRow {
  accountId: string;
  code: string;
  nameI18n: Record<string, string>;
  type: string;
  isSystem: boolean;
  isActive: boolean;
  debitTotalMinor: string;
  creditTotalMinor: string;
  /** Net in the account's natural direction (credit-normal flipped). */
  netMinor: string;
}

/**
 * GetTrialBalanceUseCase — the trial balance: every account with its debit
 * and credit totals over a date range (all-time when no range is given),
 * plus the grand totals. ACC-1 guarantees Σdebits = Σcredits, so a balanced
 * report is the ledger's self-check; the frontend flags any drift.
 *
 * Read-only; RLS scopes every row to the org. Reversals are themselves
 * balanced entries, so including them nets the original naturally (ACC-2).
 */
@Injectable()
export class GetTrialBalanceUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(filter: { fromDate?: string; toDate?: string } = {}): Promise<{
    rows: TrialBalanceRow[];
    totals: { debitTotalMinor: string; creditTotalMinor: string };
    balanced: boolean;
  }> {
    TenantContext.requireOrganizationId();

    return this.txManager.run(async (tx) => {
      const rows = await this.repo.sumAccountPeriodBalances(filter, tx);

      let debitGrand = 0n;
      let creditGrand = 0n;
      const mapped: TrialBalanceRow[] = rows.map((row) => {
        const debit = BigInt(row.debitTotalMinor);
        const credit = BigInt(row.creditTotalMinor);
        debitGrand += debit;
        creditGrand += credit;
        // Credit-normal types (liability/equity/revenue) show a credit-side
        // net; asset/expense show debit-side.
        const net = credit > debit ? credit - debit : debit - credit;
        return {
          accountId: row.id,
          code: row.code,
          nameI18n: row.nameI18n,
          type: row.type,
          isSystem: row.isSystem,
          isActive: row.isActive,
          debitTotalMinor: row.debitTotalMinor,
          creditTotalMinor: row.creditTotalMinor,
          netMinor: net.toString(),
        };
      });

      return {
        rows: mapped,
        totals: { debitTotalMinor: debitGrand.toString(), creditTotalMinor: creditGrand.toString() },
        balanced: debitGrand === creditGrand,
      };
    });
  }
}
