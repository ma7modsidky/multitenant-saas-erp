// Accounting DTOs — request validation schemas (zod) + Swagger response
// classes. Money is ALWAYS integer minor units as strings (hard rule #3).
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

// ─── Shared primitives ──────────────────────────────────────────────────────

const moneySchema = z.object({
  amountMinor: z.string().regex(/^\d+$/, 'amountMinor must be a non-negative integer string (minor units)'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be an uppercase ISO 4217 code'),
});

const quantitySchema = z.string().regex(/^\d+(\.\d+)?$/, 'quantity must be a plain decimal string');

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)');

// ─── Chart of accounts (ACC-5/ACC-16) ──────────────────────────────────────

export const createAccountSchema = z
  .object({
    // ACC-5: codes are 4-digit numeric and unique per org (matches the seeded
    // SME chart's code format so sorting and the journal combobox stay tidy).
    code: z.string().regex(/^\d{4}$/, 'code must be exactly 4 digits'),
    name: z.string().min(1).max(120),
    type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
    parentId: z.string().uuid().optional(),
  })
  .strict();

/** ACC-5: rename and/or toggle active — the code is immutable and never sent. */
export const updateAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => patch.name !== undefined || patch.isActive !== undefined, {
    message: 'at least one of name or isActive is required',
  });

// ─── Journal (ACC-1/3/4) ────────────────────────────────────────────────────

export const postJournalEntrySchema = z.object({
  entryDate: isoDateSchema,
  description: z.string().max(500).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  lines: z
    .array(
      z
        .object({
          accountId: z.string().uuid(),
          // ACC-4: exactly one of debit/credit, positive minor units.
          debit: moneySchema.optional(),
          credit: moneySchema.optional(),
          memo: z.string().max(500).nullable().optional(),
        })
        .refine((line) => (line.debit !== undefined) !== (line.credit !== undefined), {
          message: 'a journal line sets exactly one of debit or credit (ACC-4)',
        }),
    )
    .min(1, 'an entry requires at least one line'),
});

// ─── Invoice lines (ACC-6/11/14) ───────────────────────────────────────────

export const invoiceLineSchema = z.object({
  variantId: z.string().uuid().nullable().optional(),
  itemName: z.string().min(1).max(300),
  description: z.string().max(1000).nullable().optional(),
  quantity: quantitySchema.optional(),
  unitPrice: moneySchema,
  discount: moneySchema.optional(),
  taxRateId: z.string().uuid().nullable().optional(),
  taxRateBp: z.number().int().nonnegative().optional(),
  taxType: z.enum(['standard', 'reduced', 'zero', 'exempt']).optional(),
  // ACC-14: goods lines deduct stock at issuance via the movement port.
  isGoods: z.boolean().optional(),
});

export const issueInvoiceSchema = z.object({
  customerContactId: z.string().uuid().nullable().optional(),
  customerCompanyId: z.string().uuid().nullable().optional(),
  customerName: z.string().min(1).max(300),
  customerTaxId: z.string().max(50).nullable().optional(),
  sellerTaxId: z.string().max(50).nullable().optional(),
  invoiceDate: isoDateSchema.optional(),
  dueDate: isoDateSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  locale: z.string().min(1).optional(),
  sourceType: z.enum(['manual', 'pos_sale']).optional(),
  sourceId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().uuid().optional(),
  lines: z.array(invoiceLineSchema).min(1, 'an invoice requires at least one line'),
});

// ─── Payments (ACC-9) ──────────────────────────────────────────────────────

export const applyPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  method: z.enum(['cash', 'bank_transfer', 'card', 'cheque', 'other']),
  amount: moneySchema,
  reference: z.string().max(200).nullable().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

// ─── Credit notes (ACC-10) ─────────────────────────────────────────────────

export const creditNoteLineSchema = z.object({
  invoiceLineId: z.string().uuid(),
  quantity: quantitySchema.optional(),
  unitPrice: moneySchema,
  taxAmount: moneySchema.optional(),
});

export const issueCreditNoteSchema = z.object({
  invoiceId: z.string().uuid(),
  reasonCode: z.string().min(1).max(200),
  lines: z.array(creditNoteLineSchema).min(1, 'a credit note requires at least one line'),
});

// ─── Inferred DTO types ─────────────────────────────────────────────────────

export type CreateAccountDto = z.infer<typeof createAccountSchema>;
export type UpdateAccountDto = z.infer<typeof updateAccountSchema>;
export type PostJournalEntryDto = z.infer<typeof postJournalEntrySchema>;
export type IssueInvoiceDto = z.infer<typeof issueInvoiceSchema>;
export type ApplyPaymentDto = z.infer<typeof applyPaymentSchema>;
export type IssueCreditNoteDto = z.infer<typeof issueCreditNoteSchema>;

// ─── Swagger response classes ───────────────────────────────────────────────

export class AccountResponse {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() nameI18n!: Record<string, string>;
  @ApiProperty() type!: string;
  @ApiProperty() isSystem!: boolean;
  @ApiProperty() isActive!: boolean;
}

export class AccountListEnvelopeResponse {
  @ApiProperty({ type: [AccountResponse] }) data!: { items: AccountResponse[] };
}

export class JournalEntryResponse {
  @ApiProperty() id!: string;
  @ApiProperty() entryNumber!: number;
  @ApiProperty() entryDate!: string;
  @ApiProperty() description!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() status!: string;
  @ApiProperty() sourceType!: string;
  @ApiProperty() debitTotalAmountMinor!: string;
  @ApiProperty() creditTotalAmountMinor!: string;
  @ApiProperty({ nullable: true, required: false }) postedAt!: string | null;
}

export class JournalListEnvelopeResponse {
  @ApiProperty({ type: [JournalEntryResponse] })
  data!: { items: JournalEntryResponse[]; total: number; page: number; pageSize: number };
}

export class JournalEntryEnvelopeResponse {
  @ApiProperty({ type: JournalEntryResponse }) data!: JournalEntryResponse;
}

/** One journal line in the entry detail — resolved to its account. */
export class JournalEntryLineResponse {
  @ApiProperty() id!: string;
  @ApiProperty() accountId!: string;
  @ApiProperty({ nullable: true, required: false }) accountCode!: string | null;
  @ApiProperty({ nullable: true, required: false }) accountNameI18n!: Record<string, string> | null;
  @ApiProperty() debitAmountMinor!: string;
  @ApiProperty() creditAmountMinor!: string;
  @ApiProperty({ nullable: true, required: false }) memo!: string | null;
}

/** Journal entry detail — header + actor metadata + resolved lines. */
export class JournalEntryDetailEnvelopeResponse {
  @ApiProperty({ type: JournalEntryResponse }) data!: {
    entry: JournalEntryResponse & {
      sourceId: string | null;
      createdAt: string;
      createdBy: string | null;
      postedBy: string | null;
      reversedByEntryId: string | null;
      reversedBy: { id: string; entryNumber: number } | null;
      lines: JournalEntryLineResponse[];
    };
  };
}

export class InvoiceResponse {
  @ApiProperty() id!: string;
  @ApiProperty() invoiceNumber!: string;
  @ApiProperty() customerNameSnapshot!: string;
  @ApiProperty() status!: string;
  @ApiProperty() invoiceDate!: string;
  @ApiProperty() dueDate!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() subtotalAmountMinor!: string;
  @ApiProperty() discountAmountMinor!: string;
  @ApiProperty() taxAmountMinor!: string;
  @ApiProperty() totalAmountMinor!: string;
  @ApiProperty() paidAmountMinor!: string;
  @ApiProperty() creditedAmountMinor!: string;
  @ApiProperty({ nullable: true, required: false }) sourceType!: string | null;
  @ApiProperty({ nullable: true, required: false }) sourceId!: string | null;
}

export class InvoiceListEnvelopeResponse {
  @ApiProperty({ type: [InvoiceResponse] })
  data!: { items: InvoiceResponse[]; total: number; page: number; pageSize: number };
}

export class InvoiceEnvelopeResponse {
  @ApiProperty({ type: InvoiceResponse }) data!: InvoiceResponse;
}

/** One GL movement row in the account detail response. */
export class AccountMovementResponse {
  @ApiProperty() id!: string;
  @ApiProperty() entryId!: string;
  @ApiProperty() entryNumber!: number;
  @ApiProperty() entryDate!: string;
  @ApiProperty() description!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, required: false }) postedAt!: string | null;
  @ApiProperty() debitAmountMinor!: string;
  @ApiProperty() creditAmountMinor!: string;
  @ApiProperty({ nullable: true, required: false }) memo!: string | null;
  @ApiProperty() runningBalanceMinor!: string;
}

export class AccountDetailEnvelopeResponse {
  @ApiProperty({ type: AccountResponse }) data!: {
    account: AccountResponse;
    balance: { debitTotal: string; creditTotal: string; netAmountMinor: string };
    movements: AccountMovementResponse[];
  };
}

export class AccountUpdateEnvelopeResponse {
  @ApiProperty() data!: { accountId: string };
}

/** One payment row in the invoice detail response. */
export class InvoicePaymentResponse {
  @ApiProperty() id!: string;
  @ApiProperty() method!: string;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() receivedAt!: string;
  @ApiProperty({ nullable: true, required: false }) reference!: string | null;
  @ApiProperty() allocationAmountMinor!: string;
}

/** One payment receipt row in the payments list (ACC-9). */
export class PaymentListResponse {
  @ApiProperty() id!: string;
  @ApiProperty() method!: string;
  @ApiProperty() receiptNumber!: string;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() receivedAt!: string;
  @ApiProperty({ nullable: true, required: false }) reference!: string | null;
  @ApiProperty() invoiceId!: string;
  @ApiProperty() invoiceNumber!: string;
  @ApiProperty() customerNameSnapshot!: string;
  @ApiProperty() allocationAmountMinor!: string;
}

export class PaymentListEnvelopeResponse {
  @ApiProperty({ type: [PaymentListResponse] })
  data!: { items: PaymentListResponse[]; total: number; page: number; pageSize: number };
}

/** One allocation of a payment receipt to an invoice (ACC-9 breakdown). */
export class PaymentAllocationResponse {
  @ApiProperty() id!: string;
  @ApiProperty() invoiceId!: string;
  @ApiProperty() invoiceNumber!: string;
  @ApiProperty() customerNameSnapshot!: string;
  @ApiProperty() invoiceDate!: string;
  @ApiProperty() invoiceStatus!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() amountMinor!: string;
}

/** Payment receipt detail — header + allocation breakdown. */
export class PaymentDetailResponse {
  @ApiProperty() id!: string;
  @ApiProperty() method!: string;
  @ApiProperty() receiptNumber!: string;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() receivedAt!: string;
  @ApiProperty({ nullable: true, required: false }) reference!: string | null;
  @ApiProperty({ nullable: true, required: false }) createdBy!: string | null;
  @ApiProperty() createdAt!: string;
}

export class PaymentDetailEnvelopeResponse {
  @ApiProperty({ type: PaymentDetailResponse })
  data!: {
    payment: PaymentDetailResponse;
    allocations: PaymentAllocationResponse[];
    journalEntry: { id: string; entryNumber: number } | null;
  };
}

/** One credit-note header in the invoice detail response. */
export class InvoiceCreditNoteResponse {
  @ApiProperty() id!: string;
  @ApiProperty() creditNoteNumber!: string;
  @ApiProperty() status!: string;
  @ApiProperty() reasonCode!: string;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true, required: false }) issuedAt!: string | null;
}

/** Invoice detail — invoice + lines + payments + credit notes. */
export class InvoiceDetailResponse extends InvoiceResponse {
  @ApiProperty({ type: [Object] }) lines!: Record<string, unknown>[];
}

export class InvoiceDetailEnvelopeResponse {
  @ApiProperty({ type: InvoiceDetailResponse }) data!: {
    invoice: InvoiceDetailResponse;
    payments: InvoicePaymentResponse[];
    creditNotes: InvoiceCreditNoteResponse[];
    orgSellerTaxId: string | null;
    journalEntry: { id: string; entryNumber: number } | null;
  };
}

export class PaymentEnvelopeResponse {
  @ApiProperty() data!: { paymentId: string; invoiceId: string; receiptNumber: string };
}

export class CreditNoteEnvelopeResponse {
  @ApiProperty() data!: { creditNoteId: string; creditNoteNumber: string };
}

// ─── Credit notes (ACC-10) ────────────────────────────────────────────────

/** One credit-note header row in the credit-notes list (ACC-10). */
export class CreditNoteListResponse {
  @ApiProperty() id!: string;
  @ApiProperty() creditNoteNumber!: string;
  @ApiProperty() invoiceId!: string;
  @ApiProperty() invoiceNumber!: string;
  @ApiProperty() customerNameSnapshot!: string;
  @ApiProperty() status!: string;
  @ApiProperty() reasonCode!: string;
  @ApiProperty() amountMinor!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true, required: false }) issuedAt!: string | null;
  @ApiProperty() createdAt!: string;
}

export class CreditNoteListEnvelopeResponse {
  @ApiProperty({ type: [CreditNoteListResponse] })
  data!: { items: CreditNoteListResponse[]; total: number; page: number; pageSize: number };
}

/** One reversed line resolved to its item name (ACC-10). */
export class CreditNoteDetailLineResponse {
  @ApiProperty() id!: string;
  @ApiProperty() invoiceLineId!: string;
  @ApiProperty() itemNameSnapshot!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty() unitPriceAmountMinor!: string;
  @ApiProperty() taxAmountMinor!: string;
  @ApiProperty() lineTotalAmountMinor!: string;
}

/** Credit-note detail — header + reversed lines (ACC-10). */
export class CreditNoteDetailResponse extends CreditNoteListResponse {
  @ApiProperty({ type: [CreditNoteDetailLineResponse] }) lines!: CreditNoteDetailLineResponse[];
}

export class CreditNoteDetailEnvelopeResponse {
  @ApiProperty({ type: CreditNoteDetailResponse }) data!: {
    creditNote: CreditNoteDetailResponse;
    journalEntry: { id: string; entryNumber: number } | null;
  };
}

// ─── Reports (ACC-1/ACC-8/ACC-9) ────────────────────────────────────────────

/** One trial-balance row. */
export class TrialBalanceRowResponse {
  @ApiProperty() accountId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() nameI18n!: Record<string, string>;
  @ApiProperty() type!: string;
  @ApiProperty() isSystem!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() debitTotalMinor!: string;
  @ApiProperty() creditTotalMinor!: string;
  @ApiProperty() netMinor!: string;
}

export class TrialBalanceEnvelopeResponse {
  @ApiProperty({ type: [TrialBalanceRowResponse] }) data!: {
    rows: TrialBalanceRowResponse[];
    totals: { debitTotalMinor: string; creditTotalMinor: string };
    balanced: boolean;
  };
}

/** One income-statement line (revenue or expense). */
export class IncomeStatementLineResponse {
  @ApiProperty() accountId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() nameI18n!: Record<string, string>;
  @ApiProperty() netMinor!: string;
}

export class IncomeStatementEnvelopeResponse {
  @ApiProperty({ type: [IncomeStatementLineResponse] }) data!: {
    revenue: IncomeStatementLineResponse[];
    expenses: IncomeStatementLineResponse[];
    revenueTotalMinor: string;
    expenseTotalMinor: string;
    netIncomeMinor: string;
  };
}

/** One balance-sheet line. */
export class BalanceSheetLineResponse {
  @ApiProperty() accountId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() nameI18n!: Record<string, string>;
  @ApiProperty() balanceMinor!: string;
}

export class BalanceSheetEnvelopeResponse {
  @ApiProperty({ type: [BalanceSheetLineResponse] }) data!: {
    asOfDate: string;
    assets: BalanceSheetLineResponse[];
    liabilities: BalanceSheetLineResponse[];
    equity: BalanceSheetLineResponse[];
    assetTotalMinor: string;
    liabilityTotalMinor: string;
    equityTotalMinor: string;
  };
}

/** One open invoice in the AR aging report. */
export class AgingInvoiceResponse {
  @ApiProperty() invoiceId!: string;
  @ApiProperty() invoiceNumber!: string;
  @ApiProperty() customerName!: string;
  @ApiProperty() invoiceDate!: string;
  @ApiProperty() dueDate!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() balanceDueMinor!: string;
  @ApiProperty() daysPastDue!: number;
}

export class AgingBucketResponse {
  @ApiProperty() key!: string;
  @ApiProperty({ type: [AgingInvoiceResponse] }) invoices!: AgingInvoiceResponse[];
  @ApiProperty() totalMinor!: string;
}

export class ArAgingEnvelopeResponse {
  @ApiProperty() data!: {
    asOfDate: string;
    buckets: AgingBucketResponse[];
    totalOutstandingMinor: string;
  };
}
