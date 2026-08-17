import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

/** One journal line enriched with its account code + display name (ACC-4). */
export interface JournalEntryLineDetail {
  id: string;
  accountId: string;
  accountCode: string | null;
  accountNameI18n: Record<string, string> | null;
  debitAmountMinor: string;
  creditAmountMinor: string;
  memo: string | null;
}

/**
 * GetJournalEntryDetailUseCase — one journal entry with every line item
 * resolved to its account (code + name), plus the actor metadata (who created
 * / posted it) and the source reference (e.g. the invoice that produced the
 * AR entry). Read-only; RLS scopes every row to the org. The ledger is
 * append-only (ACC-2), so the detail is immutable once posted.
 */
@Injectable()
export class GetJournalEntryDetailUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { entryId: string }): Promise<{
    entry: {
      id: string;
      entryNumber: number;
      entryDate: string;
      description: string;
      currency: string;
      status: string;
      sourceType: string;
      sourceId: string | null;
      postedAt: string | null;
      postedBy: string | null;
      createdBy: string | null;
      createdAt: string;
      /** The entry that reversed this one (ACC-2) — links the reversal trail. */
      reversedByEntryId: string | null;
      /** The reversing entry's id + number, when this entry was reversed. */
      reversedBy: { id: string; entryNumber: number } | null;
      lines: JournalEntryLineDetail[];
    };
  }> {
    TenantContext.requireOrganizationId();

    return this.txManager.run(async (tx) => {
      const entry = await this.repo.findJournalEntryById(input.entryId, tx);
      if (!entry) throw new NotFoundError('Journal entry not found', { entryId: input.entryId });

      // Resolve every line's account (code + display name) from the org's COA.
      const accounts = await this.repo.listAccounts(tx);
      const accountById = new Map(accounts.map((account) => [account.id, account]));

      // ACC-2 reversal trail: when this entry was reversed, resolve the
      // reversing entry so the UI can link straight to it.
      const reversal = entry.reversedByEntryId
        ? await this.repo.findJournalEntryById(entry.reversedByEntryId, tx)
        : undefined;

      return {
        entry: {
          id: entry.id,
          entryNumber: entry.entryNumber,
          entryDate: entry.entryDate,
          description: entry.description,
          currency: entry.currency,
          status: entry.status,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          postedAt: entry.postedAt,
          postedBy: entry.postedBy,
          createdBy: entry.createdBy,
          createdAt: entry.createdAt,
          reversedByEntryId: entry.reversedByEntryId,
          reversedBy: reversal ? { id: reversal.id, entryNumber: reversal.entryNumber } : null,
          lines: entry.lines.map((line) => {
            const account = accountById.get(line.accountId);
            return {
              id: line.id,
              accountId: line.accountId,
              accountCode: account?.code ?? null,
              accountNameI18n: account?.nameI18n ?? null,
              debitAmountMinor: line.debitAmountMinor,
              creditAmountMinor: line.creditAmountMinor,
              memo: line.memo,
            };
          }),
        },
      };
    });
  }
}
