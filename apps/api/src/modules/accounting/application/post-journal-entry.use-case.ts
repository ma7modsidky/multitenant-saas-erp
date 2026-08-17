import { ACCOUNTING_EVENTS, type AccountingJournalPostedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { JournalEntry, type JournalLineInput } from '../domain/index.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

export interface PostJournalEntryInput {
  entryDate: string;
  description?: string;
  currency: string;
  sourceType: string;
  sourceId?: string | null;
  /** ACC-15: idempotency key so a replayed event cannot post twice. */
  idempotencyKey?: string | null;
  lines: JournalLineInput[];
}

/** Result of posting inside a caller transaction (ACC-6: atomic with the doc). */
export interface PostedEntry {
  entryId: string;
  entryNumber: number;
  event: {
    name: string;
    payload: AccountingJournalPostedV1;
    aggregateId: string;
  };
}

/**
 * PostJournalEntryUseCase — creates and posts a balanced journal entry
 * (ACC-1/3/4). The use case owns the transaction, allocates the next
 * gap-free entry number inside it (ACC-3), and publishes
 * `accounting.journal.posted.v1` AFTER commit (OPS-3).
 *
 * `postInTx` is the transaction-scoped core: callers that must post ATOMICALLY
 * with their own document (e.g. the AR entry when an invoice is issued,
 * ACC-6) call it inside THEIR `TransactionManager.run()` and collect the
 * returned event for after-commit publishing. `execute` wraps it in its own
 * transaction for standalone posts.
 */
@Injectable()
export class PostJournalEntryUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: PostJournalEntryInput): Promise<{ entryId: string; entryNumber: number }> {
    const committed = await this.txManager.run((tx) => this.postInTx(input, tx));
    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return { entryId: committed.entryId, entryNumber: committed.entryNumber };
  }

  /** Post inside an existing transaction; the caller publishes the event. */
  async postInTx(input: PostJournalEntryInput, tx: unknown): Promise<PostedEntry> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? 'system';
    const now = new Date();

    // ACC-15: a replayed event with the same idempotency key is a no-op —
    // return the existing entry rather than posting twice.
    if (input.idempotencyKey) {
      const existing = await this.repo.findJournalEntryByIdempotencyKey(input.idempotencyKey, tx);
      if (existing) {
        const payload: AccountingJournalPostedV1 = {
          organizationId,
          entryId: existing.id,
          entryNumber: existing.entryNumber,
          entryDate: existing.entryDate,
          currency: existing.currency,
          debitTotalAmountMinor: '0',
          creditTotalAmountMinor: '0',
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          postedAt: existing.postedAt ?? now.toISOString(),
          occurredAt: now.toISOString(),
        };
        return {
          entryId: existing.id,
          entryNumber: existing.entryNumber,
          event: {
            name: ACCOUNTING_EVENTS.JOURNAL_POSTED_V1,
            payload,
            aggregateId: existing.id,
          },
        };
      }
    }

    // ACC-3: allocate the number INSIDE the transaction — a failed post never
    // consumes it (the allocation is rolled back with the tx).
    const entryNumber = await this.repo.allocateEntryNumber(tx);

    // ACC-4: validate every line references an account from the org's COA.
    for (const line of input.lines) {
      const account = await this.repo.findAccountById(line.accountId, tx);
      if (!account) {
        throw new NotFoundError('ACCOUNTING_ACCOUNT_NOT_FOUND', { accountId: line.accountId });
      }
    }

    const entry = JournalEntry.createDraft({
      id: crypto.randomUUID(),
      organizationId,
      entryNumber,
      entryDate: input.entryDate,
      ...(input.description !== undefined ? { description: input.description } : {}),
      currency: input.currency,
      sourceType: input.sourceType,
      ...(input.sourceId !== undefined && input.sourceId !== null ? { sourceId: input.sourceId } : {}),
      ...(input.idempotencyKey !== undefined && input.idempotencyKey !== null
        ? { idempotencyKey: input.idempotencyKey }
        : {}),
      lines: input.lines,
      now,
    });

    // ACC-1/ACC-2: the entry is balanced by construction; posting is the
    // point of no return (DB trigger backstop enforces it too).
    entry.post(now, userId);
    await this.repo.insertJournalEntry(entry.toJSON(), tx);

    const payload: AccountingJournalPostedV1 = {
      organizationId,
      entryId: entry.id,
      entryNumber,
      entryDate: new Date(input.entryDate).toISOString(),
      currency: entry.currency,
      debitTotalAmountMinor: entry.debitTotal,
      creditTotalAmountMinor: entry.creditTotal,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      postedAt: now.toISOString(),
      occurredAt: now.toISOString(),
    };

    return {
      entryId: entry.id,
      entryNumber,
      event: {
        name: ACCOUNTING_EVENTS.JOURNAL_POSTED_V1,
        payload,
        aggregateId: entry.id,
      },
    };
  }
}
