import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository, type PageResult } from './ports/index.js';

/** One GL movement with its cumulative running balance (minor units). */
export interface AccountMovementDetail {
  id: string;
  entryId: string;
  entryNumber: number;
  entryDate: string;
  description: string;
  status: string;
  postedAt: string | null;
  debitAmountMinor: string;
  creditAmountMinor: string;
  memo: string | null;
  /** Source reference of the journal entry (e.g. 'invoice_issuance'). */
  sourceType: string;
  /** Id of the source document (e.g. the invoice) when one exists. */
  sourceId: string | null;
  /** Cumulative net (debit − credit) after this movement, minor units. */
  runningBalanceMinor: string;
}

export interface AccountBalanceDetail {
  debitTotal: string;
  creditTotal: string;
  /** Signed net (debit − credit) in minor units — positive = net debit. */
  netAmountMinor: string;
}

/**
 * GetAccountDetailUseCase — account header + current balance + GL history
 * (the account's general-ledger view). The movement history supports a date
 * range and pagination: the running balance is computed by the repository's
 * window function over the WHOLE filtered set before the page slice, so a
 * page always carries correct cumulative balances. Read-only; RLS scopes
 * every row to the org. The ledger is append-only (ACC-2): movements are
 * never edited or deleted, and the running balance nets reversals naturally.
 */
@Injectable()
export class GetAccountDetailUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: {
    accountId: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    account: {
      id: string;
      code: string;
      nameI18n: Record<string, string>;
      type: string;
      isSystem: boolean;
      isActive: boolean;
    };
    balance: AccountBalanceDetail;
    movements: PageResult<AccountMovementDetail>;
  }> {
    TenantContext.requireOrganizationId();

    return this.txManager.run(async (tx) => {
      const account = await this.repo.findAccountById(input.accountId, tx);
      if (!account) throw new NotFoundError('Account not found', { accountId: input.accountId });

      const [balances, movements] = await Promise.all([
        this.repo.sumAccountBalances(input.accountId, tx),
        this.repo.findAccountMovements(
          input.accountId,
          {
            ...(input.fromDate ? { fromDate: input.fromDate } : {}),
            ...(input.toDate ? { toDate: input.toDate } : {}),
            ...(input.page !== undefined ? { page: input.page } : {}),
            ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {}),
          },
          tx,
        ),
      ]);

      const debitTotal = BigInt(balances.debitTotal);
      const creditTotal = BigInt(balances.creditTotal);
      return {
        account: {
          id: account.id,
          code: account.code,
          nameI18n: account.nameI18n,
          type: account.type,
          isSystem: account.isSystem,
          isActive: account.isActive,
        },
        balance: {
          debitTotal: balances.debitTotal,
          creditTotal: balances.creditTotal,
          netAmountMinor: (debitTotal - creditTotal).toString(),
        },
        movements,
      };
    });
  }
}
