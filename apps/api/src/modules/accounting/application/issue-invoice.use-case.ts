import {
  ACCOUNTING_EVENTS,
  INVENTORY_MOVEMENT_PORT,
  type AccountingInvoiceIssuedV1,
  type InventoryMovementPort,
} from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  ACCOUNTING_ERROR_CODE,
  AccountingDomainError,
  Invoice,
  buildDefaultSmeChart,
  type InvoiceLineInput,
} from '../domain/index.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';
import { PostJournalEntryUseCase } from './post-journal-entry.use-case.js';

export interface IssueInvoiceInput {
  customerContactId?: string | null;
  customerCompanyId?: string | null;
  customerNameSnapshot: string;
  customerTaxIdSnapshot?: string | null;
  sellerTaxId?: string | null;
  invoiceDate?: string;
  dueDate: string;
  currency: string;
  locale?: string;
  sourceType?: 'manual' | 'pos_sale';
  sourceId?: string | null;
  /** ACC-13: idempotency key so a retried issuance cannot double-invoice. */
  idempotencyKey?: string | null;
  lines: InvoiceLineInput[];
}

/**
 * IssueInvoiceUseCase — creates a draft invoice, issues it, posts the AR
 * journal entry (ACC-6) and — for goods lines — deducts stock through
 * INVENTORY_MOVEMENT_PORT **inside the same transaction** (ACC-14). If the
 * stock operation fails, issuance fails.
 *
 * The AR entry is always:
 *   Dr Accounts Receivable  (invoice total)
 *   Cr Revenue              (subtotal)
 *   Cr VAT Payable          (tax)
 * Account codes are resolved from the lazily-ensured default SME chart.
 */
@Injectable()
export class IssueInvoiceUseCase {
  private movementPort: InventoryMovementPort | null = null;

  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
    private readonly portRegistry: PortRegistry,
    private readonly postJournalEntry: PostJournalEntryUseCase,
  ) {}

  /** Lazy resolution (inventory registers its port in onModuleInit). */
  private getMovementPort(): InventoryMovementPort {
    this.movementPort ??= this.portRegistry.resolve<InventoryMovementPort>(INVENTORY_MOVEMENT_PORT);
    return this.movementPort;
  }

  async execute(input: IssueInvoiceInput): Promise<{ invoiceId: string; invoiceNumber: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? 'system';
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      // ACC-13: a retried issuance with the same idempotency key returns the
      // original invoice, never a duplicate.
      if (input.idempotencyKey) {
        const existing = await this.repo.findInvoiceByIdempotencyKey(input.idempotencyKey, tx);
        if (existing) {
          return { invoiceId: existing.id, invoiceNumber: existing.invoiceNumber, event: null as never };
        }
      }

      // ACC-5: lazy idempotent COA ensure (first issuance seeds the chart).
      const existingAccounts = await this.repo.listAccounts(tx);
      if (existingAccounts.length === 0) {
        await this.repo.insertAccounts(
          buildDefaultSmeChart({ organizationId, nameResolver: (nameKey) => ({ en: nameKey }) }),
          tx,
        );
      }

      const invoiceNumber = await this.repo.allocateInvoiceNumber(tx);
      const invoice = Invoice.createDraft({
        id: crypto.randomUUID(),
        organizationId,
        invoiceNumber,
        ...(input.customerContactId !== undefined && input.customerContactId !== null
          ? { customerContactId: input.customerContactId }
          : {}),
        ...(input.customerCompanyId !== undefined && input.customerCompanyId !== null
          ? { customerCompanyId: input.customerCompanyId }
          : {}),
        customerNameSnapshot: input.customerNameSnapshot,
        ...(input.customerTaxIdSnapshot !== undefined && input.customerTaxIdSnapshot !== null
          ? { customerTaxIdSnapshot: input.customerTaxIdSnapshot }
          : {}),
        ...(input.sellerTaxId !== undefined && input.sellerTaxId !== null ? { sellerTaxId: input.sellerTaxId } : {}),
        ...(input.invoiceDate !== undefined ? { invoiceDate: input.invoiceDate } : {}),
        dueDate: input.dueDate,
        currency: input.currency,
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        sourceType: input.sourceType ?? 'manual',
        ...(input.sourceId !== undefined && input.sourceId !== null ? { sourceId: input.sourceId } : {}),
        ...(input.idempotencyKey !== undefined && input.idempotencyKey !== null
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
        lines: input.lines,
        now,
      });

      // ACC-6: issuance is the point of no return — Draft → Issued.
      invoice.issue(now);

      // ACC-13: an invoice generated from a POS sale represents a sale that was
      // ALREADY collected at the register — it defaults to Paid (the sale's
      // pos_payments rows are the immutable source of the cash receipt; the AR
      // subledger mirrors it as a payment + allocation so the paid projection
      // and the allocation sum agree). No new GL entry posts here — the cash
      // receipt was booked by POS at checkout, so posting a second Dr
      // Cash/Cr AR would double-count the money (hard rule #8: append, don't
      // mutate — the allocation row is the accounting trail for this invoice).
      if (input.sourceType === 'pos_sale') {
        invoice.applyPayment(invoice.totalAmountMinor, now);
      }

      // ACC-14: goods lines deduct stock in the SAME transaction. The caller's
      // UnitOfWork is passed as the movement-event collector so inventory
      // registers movement_recorded events for OUR commit (ACC-15).
      if (invoice.hasGoodsLines) {
        const goodsLines = invoice.lines.filter((l) => l.isGoods);
        await this.getMovementPort().issue(
          {
            lines: goodsLines.map((l) => ({
              variantId: l.variantId!,
              quantity: l.quantity,
              // The GL's COGS entry snapshots the CURRENT moving-average cost.
              unitCostAmountMinor: l.unitPriceAmountMinor,
              unitCostCurrency: invoice.currency,
            })),
            referenceType: 'sales_invoice',
            referenceId: invoice.id,
            ...(invoice.idempotencyKey !== null ? { idempotencyKey: invoice.idempotencyKey } : {}),
          },
          this.txManager.ref(tx),
          this.unitOfWork,
        );
      }

      await this.repo.insertInvoice(invoice.toJSON(), tx);

      // ACC-13: persist the Paid default for POS-generated invoices — a payment
      // + allocation row (so Σ allocations = total) and the status flip the
      // aggregate computed. Events are NOT published: the cash was received by
      // POS, whose own events already carry it — publishing PAYMENT_RECEIVED
      // here would misattribute the receipt to the accounting module.
      if (input.sourceType === 'pos_sale') {
        const paymentId = crypto.randomUUID();
        // ACC-9: POS receipts carry a gap-free receipt number like manual ones.
        const receiptNumber = await this.repo.allocateReceiptNumber(tx);
        await this.repo.insertPayment(
          {
            id: paymentId,
            organizationId,
            method: 'other',
            receiptNumber,
            amountMinor: invoice.totalAmountMinor,
            currency: invoice.currency,
            receivedAt: now,
            reference: `POS sale`,
            // The sale id is the invoice's idempotency key — reusing it keeps
            // the payment idempotent under replayed events too.
            idempotencyKey: invoice.idempotencyKey,
          },
          tx,
        );
        await this.repo.insertPaymentAllocation(
          {
            id: crypto.randomUUID(),
            organizationId,
            paymentId,
            invoiceId: invoice.id,
            amountMinor: invoice.totalAmountMinor,
            currency: invoice.currency,
          },
          tx,
        );
        await this.repo.updateInvoicePaidAmount(invoice.id, invoice.toJSON().paidAmountMinor, tx);
        await this.repo.updateInvoiceStatus(invoice.id, invoice.status, tx);
      }

      // ACC-6: the AR entry posts atomically with issuance.
      const accounts = await this.repo.listAccounts(tx);
      const codeToId = new Map(accounts.map((a) => [a.code, a.id]));
      const arAccountId = codeToId.get('1200'); // Accounts Receivable
      const revenueAccountId = codeToId.get('4000'); // Revenue
      const vatAccountId = codeToId.get('2100'); // VAT Payable (output) — fallback
      if (!arAccountId || !revenueAccountId || !vatAccountId) {
        throw new AccountingDomainError(
          'ACCOUNTING_COA_INCOMPLETE',
          'The default chart of accounts is missing a required account (ACC-5).',
        );
      }

      // ACC-11: tax credits split by each line's tax-rate COA account so the
      // GL records the right VAT account (the rate's coa_account_id, falling
      // back to 2100 Output VAT when a rate is unmapped or unknown). Grouping
      // keeps the entry to one leg per distinct tax account.
      const rateRows = await this.repo.listTaxRates(tx);
      const rateById = new Map(rateRows.map((r) => [r.id, r]));
      const taxByAccount = new Map<string, bigint>();
      for (const line of invoice.toJSON().lines) {
        if (line.taxAmountMinor === '0') continue;
        const rate = line.taxRateId ? rateById.get(line.taxRateId) : undefined;
        const accountId = rate?.coaAccountId ?? vatAccountId;
        taxByAccount.set(accountId, (taxByAccount.get(accountId) ?? 0n) + BigInt(line.taxAmountMinor));
      }

      const entryInput = {
        entryDate: input.invoiceDate ?? now.toISOString().slice(0, 10),
        description: `Invoice ${invoiceNumber}`,
        currency: invoice.currency,
        sourceType: 'invoice_issuance',
        sourceId: invoice.id,
        idempotencyKey: invoice.idempotencyKey,
        lines: [
          { accountId: arAccountId, debitAmountMinor: invoice.totalAmountMinor },
          { accountId: revenueAccountId, creditAmountMinor: invoice.toJSON().subtotalAmountMinor },
          ...Array.from(taxByAccount.entries()).map(([accountId, tax]) => ({
            accountId,
            creditAmountMinor: tax.toString(),
          })),
        ],
      } satisfies Parameters<PostJournalEntryUseCase['postInTx']>[0];

      // ACC-6: the AR entry posts INSIDE this transaction (postInTx joins our
      // tx; the returned event publishes after OUR commit alongside the
      // invoice event — OPS-3). If the entry fails, the invoice never issues.
      const posted = await this.postJournalEntry.postInTx(entryInput, tx);

      const payload: AccountingInvoiceIssuedV1 = {
        organizationId,
        invoiceId: invoice.id,
        invoiceNumber,
        customerContactId: invoice.toJSON().customerContactId,
        customerCompanyId: invoice.toJSON().customerCompanyId,
        customerNameSnapshot: invoice.toJSON().customerNameSnapshot,
        subtotalAmountMinor: invoice.toJSON().subtotalAmountMinor,
        discountAmountMinor: invoice.toJSON().discountAmountMinor,
        taxAmountMinor: invoice.toJSON().taxAmountMinor,
        totalAmountMinor: invoice.toJSON().totalAmountMinor,
        currency: invoice.currency,
        invoiceDate: invoice.toJSON().invoiceDate,
        dueDate: invoice.toJSON().dueDate,
        lineCount: invoice.lines.length,
        sourceType: invoice.sourceType,
        sourceId: invoice.sourceId,
        issuedAt: now.toISOString(),
        occurredAt: now.toISOString(),
      };
      const event = {
        name: ACCOUNTING_EVENTS.INVOICE_ISSUED_V1,
        payload,
        aggregateId: invoice.id,
      } satisfies Parameters<UnitOfWork['addEvent']>[0];

      return { invoiceId: invoice.id, invoiceNumber, entryId: posted.entryId, event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return { invoiceId: committed.invoiceId, invoiceNumber: committed.invoiceNumber };
  }
}
