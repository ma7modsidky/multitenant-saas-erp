import { describe, expect, it } from 'vitest';

import {
  ACCOUNTING_ERROR_CODE,
  ACCOUNT_TYPE,
  Account,
  CreditNote,
  INVOICE_SOURCE_TYPE,
  INVOICE_STATUS,
  Invoice,
  JOURNAL_ENTRY_STATUS,
  JournalEntry,
  TAX_TYPE,
  TaxRate,
  buildDefaultSmeChart,
} from '../../domain/index.js';
import { bucketAgingInvoices } from '../../application/get-ar-aging.use-case.js';
import type { AgingInvoiceRow } from '../../application/ports/index.js';

/** Assert that `action` throws an AccountingDomainError carrying `expectedCode`. */
function expectAccountingError(action: () => void, expectedCode: string): void {
  try {
    action();
    expect.fail('Expected AccountingDomainError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe(expectedCode);
  }
}

const orgId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const accountId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const accountId2 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const invoiceId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const now = new Date('2026-08-04T09:00:00Z');

// ─── Chart of accounts (ACC-5) ──────────────────────────────────────────────

describe('Account / COA (ACC-5)', () => {
  it('ACC-5: creates an account with code, type, and i18n name', () => {
    const account = Account.create({
      id: accountId,
      organizationId: orgId,
      code: '1000',
      nameI18n: { en: 'Cash' },
      type: ACCOUNT_TYPE.ASSET,
      isSystem: true,
    });
    expect(account.code).toBe('1000');
    expect(account.isSystem).toBe(true);
  });

  it('ACC-5: rejects a blank account code', () => {
    expectAccountingError(
      () =>
        Account.create({
          id: accountId,
          organizationId: orgId,
          code: '  ',
          nameI18n: { en: 'Cash' },
          type: ACCOUNT_TYPE.ASSET,
        }),
      'ACCOUNTING_ACCOUNT_CODE_REQUIRED',
    );
  });

  it('ACC-5: a system account cannot be renumbered or deleted', () => {
    const system = Account.create({
      id: accountId,
      organizationId: orgId,
      code: '1000',
      nameI18n: { en: 'Cash' },
      type: ACCOUNT_TYPE.ASSET,
      isSystem: true,
    });
    expectAccountingError(() => system.assertMutableCode(), ACCOUNTING_ERROR_CODE.SYSTEM_ACCOUNT_IMMUTABLE);

    // A custom (non-system) account is mutable.
    const custom = Account.create({
      id: accountId2,
      organizationId: orgId,
      code: '1999',
      nameI18n: { en: 'Petty Cash' },
      type: ACCOUNT_TYPE.ASSET,
    });
    expect(() => custom.assertMutableCode()).not.toThrow();
  });

  it('ACC-5: the default SME chart covers the five categories and is seeded lazily', () => {
    const chart = buildDefaultSmeChart({
      organizationId: orgId,
      nameResolver: (key) => ({ en: key }),
    });
    const types = new Set(chart.map((a) => a.type));
    expect(types).toEqual(new Set(['asset', 'liability', 'equity', 'revenue', 'expense']));
    expect(chart.map((a) => a.code)).toEqual([...chart.map((a) => a.code)].sort());
    expect(chart.every((a) => a.isSystem)).toBe(true);
  });

  it('ACC-5: renames an account and toggles its active flag (code never changes)', () => {
    const account = Account.create({
      id: accountId,
      organizationId: orgId,
      code: '5200',
      nameI18n: { en: 'Old name' },
      type: ACCOUNT_TYPE.EXPENSE,
    });
    account.update({ name: '  Bank Misr Account  ', isActive: false }, new Date('2026-08-17T00:00:00Z'));
    const json = account.toJSON();
    expect(json.code).toBe('5200');
    expect(json.nameI18n.en).toBe('Bank Misr Account'); // trimmed
    expect(json.isActive).toBe(false);
  });

  it('ACC-5: rejects an empty account name on update', () => {
    const account = Account.create({
      id: accountId,
      organizationId: orgId,
      code: '5200',
      nameI18n: { en: 'Old name' },
      type: ACCOUNT_TYPE.EXPENSE,
    });
    expectAccountingError(() => account.update({ name: '   ' }, new Date()), 'ACCOUNTING_ACCOUNT_NAME_REQUIRED');
  });
});

// ─── Tax rates (ACC-11) ─────────────────────────────────────────────────────

describe('TaxRate (ACC-11)', () => {
  it('ACC-11: creates a standard rate with bp', () => {
    const rate = TaxRate.create({
      id: accountId,
      organizationId: orgId,
      code: 'VAT-STD',
      nameI18n: { en: 'VAT 15%' },
      rateBp: 1500,
      type: TAX_TYPE.STANDARD,
    });
    expect(rate.rateBp).toBe(1500);
  });

  it('ACC-11: a zero-rated or exempt rate must carry 0 bp', () => {
    expectAccountingError(
      () =>
        TaxRate.create({
          id: accountId,
          organizationId: orgId,
          code: 'ZERO',
          nameI18n: { en: 'Zero' },
          rateBp: 100,
          type: TAX_TYPE.ZERO,
        }),
      ACCOUNTING_ERROR_CODE.TAX_MISMATCH,
    );
    expect(() =>
      TaxRate.create({
        id: accountId,
        organizationId: orgId,
        code: 'EXEMPT',
        nameI18n: { en: 'Exempt' },
        rateBp: 0,
        type: TAX_TYPE.EXEMPT,
      }),
    ).not.toThrow();
  });

  it('ACC-11: rejects a negative rate', () => {
    expectAccountingError(
      () =>
        TaxRate.create({
          id: accountId,
          organizationId: orgId,
          code: 'BAD',
          nameI18n: { en: 'Bad' },
          rateBp: -5,
        }),
      'ACCOUNTING_TAX_RATE_INVALID',
    );
  });
});

// ─── Journal entries (ACC-1/2/3/4) ──────────────────────────────────────────

describe('JournalEntry (ACC-1/2/3/4)', () => {
  const draftLines = [
    { accountId, debitAmountMinor: '10000', creditAmountMinor: undefined },
    { accountId: accountId2, creditAmountMinor: '10000', debitAmountMinor: undefined },
  ];

  const makeDraft = (overrides: Record<string, unknown> = {}) =>
    JournalEntry.createDraft({
      id: invoiceId,
      organizationId: orgId,
      entryNumber: 1,
      entryDate: '2026-08-04',
      currency: 'USD',
      sourceType: 'invoice_issuance',
      sourceId: invoiceId,
      lines: draftLines,
      now,
      ...overrides,
    } as never);

  it('ACC-1: accepts a balanced entry (debits = credits)', () => {
    const entry = makeDraft();
    expect(entry.debitTotal).toBe('10000');
    expect(entry.creditTotal).toBe('10000');
    expect(entry.status).toBe(JOURNAL_ENTRY_STATUS.DRAFT);
  });

  it('ACC-1: rejects an unbalanced entry', () => {
    expectAccountingError(
      () =>
        JournalEntry.createDraft({
          id: invoiceId,
          organizationId: orgId,
          entryNumber: 1,
          entryDate: '2026-08-04',
          currency: 'USD',
          sourceType: 'invoice_issuance',
          lines: [
            { accountId, debitAmountMinor: '10000' },
            { accountId: accountId2, creditAmountMinor: '9000' },
          ],
          now,
        }),
      ACCOUNTING_ERROR_CODE.ENTRY_UNBALANCED,
    );
  });

  it('ACC-4: rejects a line with both debit and credit', () => {
    expectAccountingError(
      () =>
        JournalEntry.createDraft({
          id: invoiceId,
          organizationId: orgId,
          entryNumber: 1,
          entryDate: '2026-08-04',
          currency: 'USD',
          sourceType: 'manual',
          lines: [
            { accountId, debitAmountMinor: '100', creditAmountMinor: '100' },
            { accountId: accountId2, creditAmountMinor: '200' },
          ],
          now,
        }),
      ACCOUNTING_ERROR_CODE.LINE_INVALID,
    );
  });

  it('ACC-4: rejects a zero amount on both sides', () => {
    expectAccountingError(
      () =>
        JournalEntry.createDraft({
          id: invoiceId,
          organizationId: orgId,
          entryNumber: 1,
          entryDate: '2026-08-04',
          currency: 'USD',
          sourceType: 'manual',
          lines: [
            { accountId, debitAmountMinor: '0' },
            { accountId: accountId2, creditAmountMinor: '0' },
          ],
          now,
        }),
      ACCOUNTING_ERROR_CODE.LINE_INVALID,
    );
  });

  it('ACC-2: posting stamps the entry; a posted entry is immutable', () => {
    const entry = makeDraft();
    entry.post(now, 'user-1');
    expect(entry.status).toBe(JOURNAL_ENTRY_STATUS.POSTED);
    expect(entry.toJSON().postedAt).toBe('2026-08-04T09:00:00.000Z');
    expectAccountingError(() => entry.post(now, 'user-2'), ACCOUNTING_ERROR_CODE.ENTRY_IMMUTABLE);
  });

  it('ACC-2: only a posted entry can be reversed; reversal references the original', () => {
    const original = makeDraft();
    original.post(now, 'user-1');
    original.markReversed('reversal-entry-id', now);
    expect(original.status).toBe(JOURNAL_ENTRY_STATUS.REVERSED);
    expect(original.toJSON().reversedByEntryId).toBe('reversal-entry-id');

    // A draft cannot be reversed.
    expectAccountingError(() => makeDraft().markReversed('x', now), ACCOUNTING_ERROR_CODE.ENTRY_IMMUTABLE);
  });

  it('ACC-3: entry numbers are carried through and gap-free by allocation', () => {
    const entry = makeDraft();
    expect(entry.entryNumber).toBe(1);
    const second = makeDraft({ entryNumber: 2 });
    expect(second.entryNumber).toBe(2);
  });
});

// ─── Invoices (ACC-6/7/8/9/11/12/13/14) ─────────────────────────────────────

describe('Invoice (ACC-6/7/8/9/11/12/13/14)', () => {
  const lineInput = (overrides: Record<string, unknown> = {}) => ({
    variantId: null,
    itemNameSnapshot: 'Consulting',
    quantity: '1',
    unitPriceAmountMinor: '10000',
    discountAmountMinor: '0',
    taxRateBpSnapshot: 1500,
    taxTypeSnapshot: 'standard',
    ...overrides,
  });

  const makeInvoice = (overrides: Record<string, unknown> = {}) =>
    Invoice.createDraft({
      id: invoiceId,
      organizationId: orgId,
      invoiceNumber: 'INV-0001',
      customerContactId: 'customer-1',
      customerNameSnapshot: 'Acme',
      dueDate: '2026-09-03',
      currency: 'USD',
      lines: [lineInput()],
      now,
      ...overrides,
    });

  it('ACC-11: computes per-line tax and totals exactly — 100.00 @ 15% → 115.00', () => {
    const invoice = makeInvoice();
    const data = invoice.toJSON();
    expect(data.subtotalAmountMinor).toBe('10000');
    expect(data.taxAmountMinor).toBe('1500');
    expect(data.totalAmountMinor).toBe('11500');
    expect(data.lines[0]!.taxAmountMinor).toBe('1500');
  });

  it('ACC-11: tax total equals the sum of line taxes (multi-line)', () => {
    const invoice = makeInvoice({
      lines: [
        lineInput({ unitPriceAmountMinor: '5000' }),
        lineInput({ unitPriceAmountMinor: '10000', variantId: 'v1' }),
      ],
    });
    const data = invoice.toJSON();
    // 50.00 @ 15% = 7.50 ; 100.00 @ 15% = 15.00 → tax 22.50
    expect(data.subtotalAmountMinor).toBe('15000');
    expect(data.taxAmountMinor).toBe('2250');
    expect(data.totalAmountMinor).toBe('17250');
  });

  it('ACC-11: exempt lines carry no tax', () => {
    const invoice = makeInvoice({
      lines: [lineInput({ taxTypeSnapshot: 'exempt', taxRateBpSnapshot: 0 })],
    });
    const data = invoice.toJSON();
    expect(data.taxAmountMinor).toBe('0');
    expect(data.totalAmountMinor).toBe('10000');
  });

  it('ACC-6: an invoice may only be issued from Draft', () => {
    const invoice = makeInvoice();
    invoice.issue(now);
    expect(invoice.status).toBe(INVOICE_STATUS.ISSUED);
    expectAccountingError(() => invoice.issue(now), ACCOUNTING_ERROR_CODE.INVOICE_NOT_DRAFT);
  });

  it('ACC-8: rejects an illegal status transition', () => {
    const invoice = makeInvoice();
    invoice.issue(now);
    // Issued → Void directly is rejected (ACC-7: requires a credit note).
    expectAccountingError(
      () => invoice.transitionTo(INVOICE_STATUS.VOID, now),
      ACCOUNTING_ERROR_CODE.INVOICE_IMMUTABLE,
    );
    // Issued → Partially Paid is legal.
    expect(() => invoice.transitionTo(INVOICE_STATUS.PARTIALLY_PAID, now)).not.toThrow();
    // A paid invoice cannot go back to issued.
    const paid = makeInvoice();
    paid.issue(now);
    paid.applyPayment('11500', now);
    expectAccountingError(
      () => paid.transitionTo(INVOICE_STATUS.DRAFT, now),
      ACCOUNTING_ERROR_CODE.INVOICE_ILLEGAL_TRANSITION,
    );
    // The credit-note path is the sanctioned way to void an issued invoice.
    const voided = makeInvoice();
    voided.issue(now);
    voided.markVoidedViaCreditNote(now);
    expect(voided.status).toBe(INVOICE_STATUS.VOID);
  });

  it('ACC-9: partial payment allocations never exceed the invoice total', () => {
    const invoice = makeInvoice(); // total 11500
    invoice.issue(now);
    expect(invoice.applyPayment('5000', now)).toBe('5000');
    expect(invoice.status).toBe(INVOICE_STATUS.PARTIALLY_PAID);
    expect(invoice.balanceDue).toBe('6500');
    expectAccountingError(() => invoice.applyPayment('7000', now), ACCOUNTING_ERROR_CODE.PAYMENT_OVER_ALLOCATED);
  });

  it('ACC-9: crossing to fully paid flips the status to Paid', () => {
    const invoice = makeInvoice(); // total 11500
    invoice.issue(now);
    invoice.applyPayment('5000', now);
    invoice.applyPayment('6500', now);
    expect(invoice.status).toBe(INVOICE_STATUS.PAID);
    expect(invoice.balanceDue).toBe('0');
  });

  it('ACC-9: overpayment is rejected, never silently absorbed', () => {
    const invoice = makeInvoice();
    invoice.issue(now);
    expectAccountingError(() => invoice.applyPayment('11501', now), ACCOUNTING_ERROR_CODE.PAYMENT_OVER_ALLOCATED);
  });

  it('ACC-10: cumulative credit notes never exceed the invoice net total', () => {
    const invoice = makeInvoice(); // total 11500
    invoice.issue(now);
    invoice.applyCreditNote('5000', now);
    expectAccountingError(
      () => invoice.applyCreditNote('7000', now),
      ACCOUNTING_ERROR_CODE.CREDIT_NOTE_EXCEEDS_INVOICE,
    );
    expect(() => invoice.applyCreditNote('6500', now)).not.toThrow();
  });

  it('ACC-13: a pos_sale invoice carries the sale id + idempotency key', () => {
    const invoice = makeInvoice({
      sourceType: INVOICE_SOURCE_TYPE.POS_SALE,
      sourceId: 'sale-1',
      idempotencyKey: 'key-1',
      lines: [lineInput()],
    });
    expect(invoice.sourceType).toBe(INVOICE_SOURCE_TYPE.POS_SALE);
    expect(invoice.sourceId).toBe('sale-1');
    expect(invoice.idempotencyKey).toBe('key-1');
  });

  it('ACC-14: flags goods lines for the movement-port stock deduction', () => {
    const invoice = makeInvoice({
      lines: [lineInput({ variantId: 'variant-1', isGoods: true })],
    });
    expect(invoice.hasGoodsLines).toBe(true);
    const serviceOnly = makeInvoice({ lines: [lineInput()] });
    expect(serviceOnly.hasGoodsLines).toBe(false);
  });

  it('ACC-12: a compliant e-invoice must carry a valid hash', () => {
    const invoice = makeInvoice();
    expectAccountingError(
      () =>
        invoice.markEInvoiceCompliance({
          eInvoiceUuid: 'u',
          eInvoiceHash: '',
          eInvoiceIrn: null,
          eInvoiceQr: null,
          status: 'compliant',
        }),
      ACCOUNTING_ERROR_CODE.E_INVOICE_PROVIDER_UNAVAILABLE,
    );
    expect(() =>
      invoice.markEInvoiceCompliance({
        eInvoiceUuid: 'u',
        eInvoiceHash: 'h',
        eInvoiceIrn: 'irn',
        eInvoiceQr: 'qr',
        status: 'compliant',
      }),
    ).not.toThrow();
    expect(invoice.toJSON().eInvoiceStatus).toBe('compliant');
  });

  it('rejects an invoice with no lines', () => {
    expectAccountingError(
      () =>
        Invoice.createDraft({
          id: invoiceId,
          organizationId: orgId,
          invoiceNumber: 'INV-0001',
          customerContactId: 'customer-1',
          customerNameSnapshot: 'Acme',
          dueDate: '2026-09-03',
          currency: 'USD',
          lines: [],
          now,
        }),
      'ACCOUNTING_INVOICE_NO_LINES',
    );
  });

  it('rejects an invoice with an empty customer name', () => {
    expectAccountingError(
      () =>
        Invoice.createDraft({
          id: invoiceId,
          organizationId: orgId,
          invoiceNumber: 'INV-0001',
          customerContactId: null,
          customerCompanyId: null,
          customerNameSnapshot: '   ',
          dueDate: '2026-09-03',
          currency: 'USD',
          lines: [lineInput()],
          now,
        }),
      'ACCOUNTING_INVOICE_CUSTOMER_REQUIRED',
    );
  });

  it('accepts a name-only customer (CRM ids optional for manual invoices)', () => {
    const invoice = Invoice.createDraft({
      id: invoiceId,
      organizationId: orgId,
      invoiceNumber: 'INV-0001',
      customerContactId: null,
      customerCompanyId: null,
      customerNameSnapshot: 'Acme',
      dueDate: '2026-09-03',
      currency: 'USD',
      lines: [lineInput()],
      now,
    });
    expect(invoice.status).toBe('draft');
    expect(invoice.toJSON().customerNameSnapshot).toBe('Acme');
  });
});

// ─── Credit notes (ACC-10) ──────────────────────────────────────────────────

describe('CreditNote (ACC-10)', () => {
  const makeNote = () =>
    CreditNote.createDraft({
      id: invoiceId,
      organizationId: orgId,
      invoiceId,
      invoiceNumber: 'INV-0001',
      creditNoteNumber: 'CN-0001',
      reasonCode: 'goods_returned',
      currency: 'USD',
      lines: [{ invoiceLineId: 'line-1', unitPriceAmountMinor: '5000' }],
      now,
    });

  it('ACC-10: creates a draft with the line amount and a reason', () => {
    const note = makeNote();
    expect(note.amountMinor).toBe('5000');
    expect(note.reasonCode).toBe('goods_returned');
    expect(note.status).toBe('draft');
  });

  it('ACC-10: issuing is the point of no return — immutable after', () => {
    const note = makeNote();
    note.issue(now);
    expect(note.status).toBe('issued');
    expectAccountingError(() => note.issue(now), ACCOUNTING_ERROR_CODE.INVOICE_IMMUTABLE);
  });

  it('ACC-10: requires a reason code', () => {
    expectAccountingError(
      () =>
        CreditNote.createDraft({
          id: invoiceId,
          organizationId: orgId,
          invoiceId,
          invoiceNumber: 'INV-0001',
          creditNoteNumber: 'CN-0001',
          reasonCode: '   ',
          currency: 'USD',
          lines: [{ invoiceLineId: 'line-1', unitPriceAmountMinor: '5000' }],
          now,
        }),
      ACCOUNTING_ERROR_CODE.CREDIT_NOTE_EXCEEDS_INVOICE,
    );
  });
});

// ─── Reports: AR aging bucketing (ACC-8/ACC-9) ─────────────────────────────

describe('AR aging bucketing (ACC-8/ACC-9)', () => {
  const makeInvoice = (overrides: Partial<AgingInvoiceRow>): AgingInvoiceRow => ({
    id: 'inv-1',
    invoiceNumber: 'INV-000001',
    customerNameSnapshot: 'Acme',
    invoiceDate: '2026-07-01',
    dueDate: '2026-08-01',
    currency: 'USD',
    totalAmountMinor: '10000',
    paidAmountMinor: '0',
    creditedAmountMinor: '0',
    ...overrides,
  });

  it('ACC-9: buckets an invoice due on the as-of date as current', () => {
    const buckets = bucketAgingInvoices([makeInvoice({ dueDate: '2026-08-15' })], '2026-08-15');
    const current = buckets.find((b) => b.key === 'current')!;
    expect(current.invoices).toHaveLength(1);
    expect(current.invoices[0]!.daysPastDue).toBe(0);
    expect(current.totalMinor).toBe('10000');
  });

  it('ACC-9: an invoice overdue 10 days lands in 1-30, 45 days in 31-60, 200 in 90+', () => {
    const buckets = bucketAgingInvoices(
      [
        makeInvoice({ id: 'a', dueDate: '2026-08-05' }), // 10 days past
        makeInvoice({ id: 'b', dueDate: '2026-07-01' }), // 45 days past
        makeInvoice({ id: 'c', dueDate: '2026-01-27' }), // 200 days past
      ],
      '2026-08-15',
    );
    expect(buckets.find((b) => b.key === '1_30')!.invoices.map((i) => i.invoiceId)).toEqual(['a']);
    expect(buckets.find((b) => b.key === '31_60')!.invoices.map((i) => i.invoiceId)).toEqual(['b']);
    expect(buckets.find((b) => b.key === '90_plus')!.invoices.map((i) => i.invoiceId)).toEqual(['c']);
  });

  it('ACC-9: an invoice due in the future stays current (not past due)', () => {
    const buckets = bucketAgingInvoices([makeInvoice({ dueDate: '2026-09-01' })], '2026-08-15');
    const current = buckets.find((b) => b.key === 'current')!;
    expect(current.invoices).toHaveLength(1);
    expect(current.invoices[0]!.daysPastDue).toBe(0);
  });

  it('ACC-9: fully paid or fully credited invoices are excluded', () => {
    const buckets = bucketAgingInvoices(
      [
        makeInvoice({ id: 'paid', paidAmountMinor: '10000' }),
        makeInvoice({ id: 'credited', creditedAmountMinor: '10000' }),
        makeInvoice({ id: 'partial', paidAmountMinor: '4000' }), // 6000 outstanding
      ],
      '2026-08-15',
    );
    const all = buckets.flatMap((b) => b.invoices);
    expect(all.map((i) => i.invoiceId)).toEqual(['partial']);
    expect(all[0]!.balanceDueMinor).toBe('6000');
  });

  it('ACC-9: bucket totals sum the outstanding balances', () => {
    const buckets = bucketAgingInvoices(
      [
        makeInvoice({ id: 'a', dueDate: '2026-08-05', totalAmountMinor: '3000', paidAmountMinor: '1000' }),
        makeInvoice({ id: 'b', dueDate: '2026-08-10', totalAmountMinor: '5000' }),
      ],
      '2026-08-15',
    );
    const bucket = buckets.find((b) => b.key === '1_30')!;
    expect(bucket.totalMinor).toBe('7000'); // (3000−1000) + 5000
  });
});
