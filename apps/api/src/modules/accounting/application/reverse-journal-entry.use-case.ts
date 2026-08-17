import { ACCOUNTING_EVENTS, type AccountingJournalPostedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ACCOUNTING_ERROR_CODE, AccountingDomainError, JournalEntry, type JournalLineInput } from '../domain/index.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

/**
 * ReverseJournalEntryUseCase — ACC-2: corrections are reversal entries, never
 * edits. Posting a reversal is a NEW entry whose lines mirror the original's
 * with the sides swapped; the original is then marked `reversed` referencing
 * the reversal. Both writes happen in one transaction.
 */
@Injectable()
export class ReverseJournalEntryUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: {
    entryId: string;
    description?: string;
  }): Promise<{ entryId: string; reversalEntryId: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? 'system';
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      const original = await this.repo.findJournalEntryById(input.entryId, tx);
      if (!original) throw new NotFoundError('ACCOUNTING_ENTRY_NOT_FOUND', { entryId: input.entryId });

      const originalEntry = JournalEntry.fromLedger(original);
      // ACC-2: only a posted entry can be reversed.
      if (originalEntry.status !== 'posted') {
        throw new AccountingDomainError(
          ACCOUNTING_ERROR_CODE.ENTRY_IMMUTABLE,
          `Entry ${originalEntry.entryNumber} is ${originalEntry.status}; only posted entries can be reversed (ACC-2).`,
          { entryId: input.entryId, status: originalEntry.status },
        );
      }

      // Mirror the lines with swapped sides (debit ↔ credit) — the reversal
      // is itself balanced (ACC-1).
      const reversedLines: JournalLineInput[] = original.lines.map((line) => ({
        accountId: line.accountId,
        ...(line.creditAmountMinor !== '0' ? { debitAmountMinor: line.creditAmountMinor } : {}),
        ...(line.debitAmountMinor !== '0' ? { creditAmountMinor: line.debitAmountMinor } : {}),
        memo: `Reversal of entry ${originalEntry.entryNumber}`,
      }));

      const entryNumber = await this.repo.allocateEntryNumber(tx);
      const reversal = JournalEntry.createDraft({
        id: crypto.randomUUID(),
        organizationId,
        entryNumber,
        entryDate: now.toISOString().slice(0, 10),
        description: input.description ?? `Reversal of entry ${originalEntry.entryNumber}`,
        currency: original.currency,
        sourceType: 'reversal',
        sourceId: original.id,
        lines: reversedLines,
        now,
      });
      reversal.post(now, userId);
      await this.repo.insertJournalEntry(reversal.toJSON(), tx);

      // Mark the original reversed, referencing the reversal entry.
      await this.repo.updateJournalEntryStatus(original.id, 'reversed', reversal.id, tx);

      const payload: AccountingJournalPostedV1 = {
        organizationId,
        entryId: reversal.id,
        entryNumber,
        entryDate: now.toISOString(),
        currency: reversal.currency,
        debitTotalAmountMinor: reversal.debitTotal,
        creditTotalAmountMinor: reversal.creditTotal,
        sourceType: 'reversal',
        sourceId: original.id,
        postedAt: now.toISOString(),
        occurredAt: now.toISOString(),
      };
      const event = {
        name: ACCOUNTING_EVENTS.JOURNAL_POSTED_V1,
        payload,
        aggregateId: reversal.id,
      } satisfies Parameters<UnitOfWork['addEvent']>[0];

      return { entryId: original.id, reversalEntryId: reversal.id, event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return { entryId: committed.entryId, reversalEntryId: committed.reversalEntryId };
  }
}
