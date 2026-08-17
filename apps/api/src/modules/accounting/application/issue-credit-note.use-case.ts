import { ACCOUNTING_EVENTS, type AccountingCreditNoteIssuedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { CreditNote, Invoice, type CreditNoteLineInput } from '../domain/index.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';
import { PostJournalEntryUseCase } from './post-journal-entry.use-case.js';

export interface IssueCreditNoteInput {
  invoiceId: string;
  reasonCode: string;
  lines: CreditNoteLineInput[];
}

/**
 * IssueCreditNoteUseCase — ACC-10: reverses a referenced invoice; cumulative
 * credit-note amounts never exceed the invoice net total. Issuance posts the
 * reversal journal entry (Dr Revenue / Cr AR) atomically and marks the invoice
 * void via the credit-note path (ACC-7) when the note fully reverses it.
 */
@Injectable()
export class IssueCreditNoteUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
    private readonly postJournalEntry: PostJournalEntryUseCase,
  ) {}

  async execute(input: IssueCreditNoteInput): Promise<{ creditNoteId: string; creditNoteNumber: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      const invoiceRow = await this.repo.findInvoiceById(input.invoiceId, tx);
      if (!invoiceRow) throw new NotFoundError('ACCOUNTING_INVOICE_NOT_FOUND', { invoiceId: input.invoiceId });

      const invoice = Invoice.fromJSON(invoiceRow);
      // ACC-10: cumulative credited amount (incl. this note) never exceeds total.
      const amount = input.lines.reduce((sum, l) => sum + BigInt(l.unitPriceAmountMinor), 0n).toString();
      invoice.applyCreditNote(amount, now);
      // Persist the new running credited amount (the ledger tables remain the
      // source of truth; the projection avoids a scan on every read).
      await this.repo.updateInvoiceCreditedAmount(input.invoiceId, invoice.toJSON().creditedAmountMinor, tx);

      const creditNoteNumber = await this.repo.allocateCreditNoteNumber(tx);
      const note = CreditNote.createDraft({
        id: crypto.randomUUID(),
        organizationId,
        invoiceId: input.invoiceId,
        invoiceNumber: invoiceRow.invoiceNumber,
        creditNoteNumber,
        reasonCode: input.reasonCode,
        currency: invoiceRow.currency,
        lines: input.lines,
        now,
      });
      note.issue(now);
      await this.repo.insertCreditNote(note.toJSON(), tx);

      // ACC-10: post the reversal (Dr Revenue, Cr AR) atomically.
      const accounts = await this.repo.listAccounts(tx);
      const codeToId = new Map(accounts.map((a) => [a.code, a.id]));
      const arAccountId = codeToId.get('1200');
      const revenueAccountId = codeToId.get('4000');
      if (!arAccountId || !revenueAccountId) {
        throw new NotFoundError('ACCOUNTING_COA_INCOMPLETE', {});
      }
      await this.postJournalEntry.postInTx(
        {
          entryDate: now.toISOString().slice(0, 10),
          description: `Credit note ${creditNoteNumber}`,
          currency: note.currency,
          sourceType: 'credit_note',
          sourceId: note.id,
          lines: [
            { accountId: revenueAccountId, debitAmountMinor: note.amountMinor },
            { accountId: arAccountId, creditAmountMinor: note.amountMinor },
          ],
        },
        tx,
      );

      // ACC-7: a credit note reversing the full invoice voids it (status change
      // only — never an edit).
      if (invoice.toJSON().creditedAmountMinor === invoiceRow.totalAmountMinor) {
        await this.repo.updateInvoiceStatus(input.invoiceId, 'void', tx);
      }

      const payload: AccountingCreditNoteIssuedV1 = {
        organizationId,
        creditNoteId: note.id,
        creditNoteNumber,
        invoiceId: input.invoiceId,
        invoiceNumber: invoiceRow.invoiceNumber,
        reasonCode: input.reasonCode,
        amountMinor: note.amountMinor,
        currency: note.currency,
        issuedAt: now.toISOString(),
        occurredAt: now.toISOString(),
      };
      const event = {
        name: ACCOUNTING_EVENTS.CREDIT_NOTE_ISSUED_V1,
        payload,
        aggregateId: note.id,
      } satisfies Parameters<UnitOfWork['addEvent']>[0];

      return { creditNoteId: note.id, creditNoteNumber, event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return { creditNoteId: committed.creditNoteId, creditNoteNumber: committed.creditNoteNumber };
  }
}
