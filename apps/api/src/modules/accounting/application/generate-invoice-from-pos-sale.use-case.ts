import type { PosSaleCompletedV1 } from '@modubiz/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';
import { IssueInvoiceUseCase } from './issue-invoice.use-case.js';

/**
 * GenerateInvoiceFromPosSaleUseCase — ACC-13: auto-invoicing from a completed
 * POS sale is idempotent — exactly ONE invoice per sale, keyed on the sale id
 * (the event's source id; the invoice's idempotency key is the sale id, so
 * both the `(organization_id, idempotency_key)` unique index and the source
 * lookup make a replayed event a no-op). The invoice references the sale id
 * without a foreign key (hard rule #1).
 *
 * The sale event carries aggregate money (POS-17: per-line tax was already
 * computed by the POS), so the invoice is a single summary line whose totals
 * mirror the sale exactly — no re-computation, no rounding drift.
 */
@Injectable()
export class GenerateInvoiceFromPosSaleUseCase {
  private readonly logger = new Logger(GenerateInvoiceFromPosSaleUseCase.name);

  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
    private readonly issueInvoice: IssueInvoiceUseCase,
  ) {}

  /**
   * Handle a `pos.sale.completed.v1` payload. Idempotent per sale id: a
   * replayed event returns the existing invoice without issuing a duplicate.
   * Events that do not map to an invoice (a sale without a customer) are
   * skipped — walk-in sales are not AR documents.
   */
  async execute(payload: PosSaleCompletedV1): Promise<{ invoiceId: string; invoiceNumber: string } | null> {
    const organizationId = payload.organizationId;
    const now = new Date();

    // ACC-13: a replayed event must not create a second invoice. Checked both
    // here (fast path) and inside the issuance transaction (race-free).
    const existing = await this.txManager.run((tx) => this.repo.findInvoiceBySource('pos_sale', payload.saleId, tx));
    if (existing) {
      this.logger.debug(
        `pos.sale.completed.v1 for sale ${payload.saleId} already invoiced as ${existing.invoiceNumber}`,
      );
      return { invoiceId: existing.id, invoiceNumber: existing.invoiceNumber };
    }

    // A sale without a linked customer is a walk-in cash sale — no AR document.
    if (!payload.customerContactId) {
      this.logger.debug(`sale ${payload.saleId} has no customer contact; skipping auto-invoice (walk-in)`);
      return null;
    }

    // The invoice's idempotency key IS the sale id — the unique index backs
    // the at-most-once guarantee under concurrent replays (ACC-13, ACC-15).
    const issued = await this.issueInvoice.execute({
      customerContactId: payload.customerContactId,
      customerNameSnapshot: 'POS Customer', // snapshot; enriched when CRM lookup exists
      invoiceDate: payload.soldAt.slice(0, 10),
      dueDate: payload.soldAt.slice(0, 10), // POS sales are due on receipt
      currency: payload.currency,
      locale: payload.locale,
      sourceType: 'pos_sale',
      sourceId: payload.saleId,
      idempotencyKey: payload.saleId,
      // One summary line mirroring the sale's aggregate money (ACC-13). Tax is
      // carried over verbatim (POS-17 → ACC-11), never re-computed.
      lines: [
        {
          itemNameSnapshot: `POS Sale ${payload.receiptNumber}`,
          quantity: '1',
          unitPriceAmountMinor: payload.subtotalAmountMinor,
          discountAmountMinor: payload.discountAmountMinor,
          taxAmountMinor: payload.taxAmountMinor,
          taxTypeSnapshot: payload.taxAmountMinor === '0' ? 'zero' : 'standard',
        },
      ],
    });

    this.logger.log(`auto-invoiced POS sale ${payload.saleId} → ${issued.invoiceNumber}`);
    return issued;
  }
}
