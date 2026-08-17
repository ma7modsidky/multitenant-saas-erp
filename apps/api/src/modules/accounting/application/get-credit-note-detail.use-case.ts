import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

/**
 * GetCreditNoteDetailUseCase — one credit note with its reversed lines
 * resolved to item names (ACC-10), the referenced invoice, and the reversal
 * journal entry (Dr Revenue, Cr AR — posted atomically at issuance). Read-only;
 * RLS scopes the rows to the org. Credit notes are immutable once issued.
 */
@Injectable()
export class GetCreditNoteDetailUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { creditNoteId: string }): Promise<{
    creditNote: {
      id: string;
      creditNoteNumber: string;
      invoiceId: string;
      invoiceNumber: string;
      customerNameSnapshot: string;
      status: string;
      reasonCode: string;
      amountMinor: string;
      currency: string;
      issuedAt: string | null;
      createdAt: string;
      lines: Array<{
        id: string;
        invoiceLineId: string;
        itemNameSnapshot: string;
        quantity: string;
        unitPriceAmountMinor: string;
        taxAmountMinor: string;
        lineTotalAmountMinor: string;
      }>;
    };
    /** The reversal journal entry (Dr Revenue, Cr AR) posted at issuance — ACC-10. */
    journalEntry: { id: string; entryNumber: number } | null;
  }> {
    TenantContext.requireOrganizationId();

    return this.txManager.run(async (tx) => {
      const note = await this.repo.getCreditNoteDetail(input.creditNoteId, tx);
      if (!note) throw new NotFoundError('Credit note not found', { creditNoteId: input.creditNoteId });

      // ACC-10: the reversal entry is keyed on the note id (source_type
      // 'credit_note') — the credit-note detail links back to its GL record.
      const journalEntry = await this.repo.findJournalEntryBySource('credit_note', input.creditNoteId, tx);

      return {
        creditNote: {
          id: note.id,
          creditNoteNumber: note.creditNoteNumber,
          invoiceId: note.invoiceId,
          invoiceNumber: note.invoiceNumber,
          customerNameSnapshot: note.customerNameSnapshot,
          status: note.status,
          reasonCode: note.reasonCode,
          amountMinor: note.amountMinor,
          currency: note.currency,
          issuedAt: note.issuedAt,
          createdAt: note.createdAt,
          lines: note.lines.map((line) => ({
            id: line.id,
            invoiceLineId: line.invoiceLineId,
            itemNameSnapshot: line.itemNameSnapshot,
            quantity: line.quantity,
            unitPriceAmountMinor: line.unitPriceAmountMinor,
            taxAmountMinor: line.taxAmountMinor,
            lineTotalAmountMinor: line.lineTotalAmountMinor,
          })),
        },
        journalEntry: journalEntry ? { id: journalEntry.id, entryNumber: journalEntry.entryNumber } : null,
      };
    });
  }
}
