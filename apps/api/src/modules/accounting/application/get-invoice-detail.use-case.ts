import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

/**
 * GetInvoiceDetailUseCase — one invoice with its itemized lines, the payment
 * history timeline (ACC-9), and the credit-note trail (ACC-10). Read-only; RLS
 * scopes every row to the org. The AR document is immutable once issued
 * (ACC-7) — this view is how users inspect and act on it.
 */
@Injectable()
export class GetInvoiceDetailUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { invoiceId: string }): Promise<{
    invoice: {
      id: string;
      invoiceNumber: string;
      customerNameSnapshot: string;
      customerTaxIdSnapshot: string | null;
      sellerTaxId: string | null;
      status: string;
      invoiceDate: string;
      dueDate: string;
      currency: string;
      subtotalAmountMinor: string;
      discountAmountMinor: string;
      taxAmountMinor: string;
      totalAmountMinor: string;
      paidAmountMinor: string;
      creditedAmountMinor: string;
      sourceType: string | null;
      sourceId: string | null;
      createdAt: string;
      lines: Array<{
        id: string;
        itemNameSnapshot: string;
        description: string | null;
        quantity: string;
        unitPriceAmountMinor: string;
        discountAmountMinor: string;
        taxRateBpSnapshot: number;
        taxTypeSnapshot: string;
        taxAmountMinor: string;
        lineTotalAmountMinor: string;
      }>;
    };
    payments: Array<{
      id: string;
      method: string;
      amountMinor: string;
      currency: string;
      receivedAt: string;
      reference: string | null;
      allocationAmountMinor: string;
    }>;
    creditNotes: Array<{
      id: string;
      creditNoteNumber: string;
      status: string;
      reasonCode: string;
      amountMinor: string;
      currency: string;
      issuedAt: string | null;
    }>;
    /** The org's seller tax ID setting (ACC-6) — display fallback when the invoice snapshot is empty. */
    orgSellerTaxId: string | null;
    /** The AR journal entry generated at issuance (ACC-6) — links to the GL. */
    journalEntry: { id: string; entryNumber: number } | null;
  }> {
    TenantContext.requireOrganizationId();

    return this.txManager.run(async (tx) => {
      const invoice = await this.repo.findInvoiceById(input.invoiceId, tx);
      if (!invoice) throw new NotFoundError('Invoice not found', { invoiceId: input.invoiceId });

      const [payments, creditNotes, orgSellerTaxId, journalEntry] = await Promise.all([
        this.repo.listInvoicePayments(input.invoiceId, tx),
        this.repo.listCreditNotesByInvoice(input.invoiceId, tx),
        this.repo.getOrgSellerTaxId(tx),
        this.repo.findJournalEntryBySource('invoice_issuance', input.invoiceId, tx),
      ]);

      return {
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerNameSnapshot: invoice.customerNameSnapshot,
          customerTaxIdSnapshot: invoice.customerTaxIdSnapshot,
          sellerTaxId: invoice.sellerTaxId,
          status: invoice.status,
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          currency: invoice.currency,
          subtotalAmountMinor: invoice.subtotalAmountMinor,
          discountAmountMinor: invoice.discountAmountMinor,
          taxAmountMinor: invoice.taxAmountMinor,
          totalAmountMinor: invoice.totalAmountMinor,
          paidAmountMinor: invoice.paidAmountMinor,
          creditedAmountMinor: invoice.creditedAmountMinor,
          sourceType: invoice.sourceType,
          sourceId: invoice.sourceId,
          createdAt: invoice.createdAt,
          lines: invoice.lines.map((line) => ({
            id: line.id,
            itemNameSnapshot: line.itemNameSnapshot,
            description: line.description,
            quantity: line.quantity,
            unitPriceAmountMinor: line.unitPriceAmountMinor,
            discountAmountMinor: line.discountAmountMinor,
            taxRateBpSnapshot: line.taxRateBpSnapshot,
            taxTypeSnapshot: line.taxTypeSnapshot,
            taxAmountMinor: line.taxAmountMinor,
            lineTotalAmountMinor: line.lineTotalAmountMinor,
          })),
        },
        payments: payments.map((payment) => ({
          id: payment.id,
          method: payment.method,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          receivedAt: payment.receivedAt,
          reference: payment.reference,
          allocationAmountMinor: payment.allocationAmountMinor,
        })),
        creditNotes: creditNotes.map((note) => ({
          id: note.id,
          creditNoteNumber: note.creditNoteNumber,
          status: note.status,
          reasonCode: note.reasonCode,
          amountMinor: note.amountMinor,
          currency: note.currency,
          issuedAt: note.issuedAt,
        })),
        orgSellerTaxId,
        journalEntry: journalEntry ? { id: journalEntry.id, entryNumber: journalEntry.entryNumber } : null,
      };
    });
  }
}
