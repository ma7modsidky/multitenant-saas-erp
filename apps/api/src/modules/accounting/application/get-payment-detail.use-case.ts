import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

/**
 * GetPaymentDetailUseCase — one payment receipt with its full allocation
 * breakdown (ACC-9). A single receipt can be split across several invoices
 * (partial payments), so the detail view lists every allocation with a link
 * back to the originating invoice. Read-only; RLS scopes the rows to the org.
 */
@Injectable()
export class GetPaymentDetailUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { paymentId: string }): Promise<{
    payment: {
      id: string;
      method: string;
      receiptNumber: string;
      amountMinor: string;
      currency: string;
      receivedAt: string;
      reference: string | null;
      createdBy: string | null;
      createdAt: string;
    };
    allocations: Array<{
      id: string;
      invoiceId: string;
      invoiceNumber: string;
      customerNameSnapshot: string;
      invoiceDate: string;
      invoiceStatus: string;
      currency: string;
      amountMinor: string;
    }>;
    /** The receipt entry (Dr Bank/Cash, Cr AR) this payment posted — ACC-9. */
    journalEntry: { id: string; entryNumber: number } | null;
  }> {
    TenantContext.requireOrganizationId();

    return this.txManager.run(async (tx) => {
      const payment = await this.repo.getPayment(input.paymentId, tx);
      if (!payment) throw new NotFoundError('Payment not found', { paymentId: input.paymentId });

      // ACC-9: the receipt entry is keyed on the payment id (source_type
      // 'payment'). POS-generated receipts have no GL entry (ACC-13) — the
      // lookup returns null and the UI hides the link.
      const journalEntry = await this.repo.findJournalEntryBySource('payment', input.paymentId, tx);

      return {
        payment: {
          id: payment.id,
          method: payment.method,
          receiptNumber: payment.receiptNumber,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          receivedAt: payment.receivedAt,
          reference: payment.reference,
          createdBy: payment.createdBy,
          createdAt: payment.createdAt,
        },
        allocations: payment.allocations.map((allocation) => ({
          id: allocation.id,
          invoiceId: allocation.invoiceId,
          invoiceNumber: allocation.invoiceNumber,
          customerNameSnapshot: allocation.customerNameSnapshot,
          invoiceDate: allocation.invoiceDate,
          invoiceStatus: allocation.invoiceStatus,
          currency: allocation.currency,
          amountMinor: allocation.amountMinor,
        })),
        journalEntry: journalEntry ? { id: journalEntry.id, entryNumber: journalEntry.entryNumber } : null,
      };
    });
  }
}
