import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { TenantContext } from '../../../../core/tenancy/tenant-context.js';
import type {
  AccountMovementRow,
  AccountPeriodBalanceRow,
  AccountRow,
  AccountingRepository,
  AgingInvoiceRow,
  CreditNoteDetailRow,
  CreditNoteFilter,
  CreditNoteListRow,
  CreditNoteRow,
  InvoiceCreditNoteRow,
  InvoiceFilter,
  InvoicePaymentRow,
  InvoiceRow,
  JournalEntryRow,
  JournalFilter,
  PageResult,
  PaymentAllocationRow,
  PaymentDetailRow,
  PaymentFilter,
  PaymentListRow,
  TaxRateRow,
} from '../../application/ports/index.js';
import type {
  AccountData,
  CreditNoteData,
  InvoiceData,
  InvoiceLineData,
  JournalEntryData,
  TaxRateData,
} from '../../domain/index.js';

/**
 * Actor uuid for audit columns. System-driven paths (event handlers, jobs)
 * run with a non-UUID `system` sentinel in TenantContext — writing it to a
 * uuid column throws `invalid input syntax for type uuid`, failing the whole
 * transaction (ACC-13 auto-invoice / ACC-15 movement GL). Only a real user
 * UUID is persisted; system actions record a NULL actor.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function sanitizeActorId(value: string | null | undefined): string | null {
  return value !== undefined && value !== null && UUID_RE.test(value) ? value : null;
}

/**
 * DrizzleAccountingRepository — Drizzle implementation of AccountingRepository.
 *
 * RLS scopes every query to the current organization (fail-closed), so no
 * manual organization_id filters are used (hard rule #2). Inserts populate
 * organization_id from TenantContext, never from client input.
 *
 * Ledger discipline (hard rule #8): acc_journal_entries / acc_journal_lines
 * are append-only once posted (ACC-2) — this repository only UPDATEs the
 * status/reversal columns of entries it posted moments earlier in the same
 * transaction, and never DELETEs a ledger row.
 */
@Injectable()
export class DrizzleAccountingRepository implements AccountingRepository {
  private readonly accounts = sql.identifier('acc_accounts');
  private readonly taxRates = sql.identifier('acc_tax_rates');
  private readonly journalEntries = sql.identifier('acc_journal_entries');
  private readonly journalLines = sql.identifier('acc_journal_lines');
  private readonly invoices = sql.identifier('acc_invoices');
  private readonly invoiceLines = sql.identifier('acc_invoice_lines');
  private readonly payments = sql.identifier('acc_payments');
  private readonly paymentAllocations = sql.identifier('acc_payment_allocations');
  private readonly creditNotes = sql.identifier('acc_credit_notes');
  private readonly creditNoteLines = sql.identifier('acc_credit_note_lines');
  private readonly orgSettings = sql.identifier('acc_org_settings');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  /** `'a','b'` fragment for `IN (...)` — postgres.js can't bind JS arrays. */
  private valueList(values: string[]): ReturnType<typeof sql> {
    return sql.join(
      values.map((value) => sql`${value}`),
      sql.raw(', '),
    );
  }

  /** bigint money column → minor-units string; null/undefined → '0'. */
  private minor(row: Record<string, unknown>, key: string): string {
    const value = row[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return '0';
  }

  /** bigint money column that may be NULL → minor-units string or null. */
  private nullableMinor(row: Record<string, unknown>, key: string): string | null {
    const value = row[key];
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return null;
  }

  /** numeric(18,4) comes back as '10.0000' — normalize to plain decimals. */
  private decimal(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number') return '0';
    const raw = String(value);
    if (!raw.includes('.')) return raw;
    return raw.replace(/\.?0+$/, '') || '0';
  }

  /** jsonb column → object; null/undefined → {}. */
  private jsonb(row: Record<string, unknown>, key: string): Record<string, string> {
    const value = row[key];
    if (typeof value === 'object' && value !== null) return value as Record<string, string>;
    return {};
  }

  // ─── Chart of accounts (ACC-5) ─────────────────────────────────────────

  async listAccounts(tx?: TxOrDb): Promise<AccountRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.accounts}
      WHERE deleted_at IS NULL
      ORDER BY code ASC
    `);
    return rows.map((row) => this.rowToAccount(row));
  }

  async findAccountByCode(code: string, tx?: TxOrDb): Promise<AccountRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.accounts} WHERE code = ${code} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    return row ? this.rowToAccount(row) : undefined;
  }

  async findAccountById(id: string, tx?: TxOrDb): Promise<AccountRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.accounts} WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    return row ? this.rowToAccount(row) : undefined;
  }

  async insertAccounts(accounts: AccountData[], tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = sanitizeActorId(TenantContext.getUserId());
    for (const account of accounts) {
      await db.execute(sql`
        INSERT INTO ${this.accounts}
          (id, organization_id, code, name_i18n, type, parent_id, is_system, is_active,
           created_at, updated_at, created_by, updated_by)
        VALUES
          (${account.id}, ${organizationId}, ${account.code}, ${JSON.stringify(account.nameI18n)}::jsonb,
           ${account.type}, ${account.parentId}, ${account.isSystem}, ${account.isActive},
           ${toDbDate(new Date(account.createdAt))}, ${toDbDate(new Date(account.updatedAt))}, ${userId}, ${userId})
      `);
    }
  }

  /** ACC-5: rename (name_i18n.en) and/or toggle is_active. Code never changes. */
  async updateAccount(id: string, patch: { name?: string; isActive?: boolean }, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    const sets = [sql`updated_at = NOW()`];
    if (patch.name !== undefined) {
      // Preserve existing locale entries; only the `en` display name is edited
      // (the create form stores the name as `en`, ACC-5 rename semantics).
      sets.push(sql`name_i18n = jsonb_set(name_i18n, '{en}', ${JSON.stringify(patch.name)}::jsonb)`);
    }
    if (patch.isActive !== undefined) {
      sets.push(sql`is_active = ${patch.isActive}`);
    }
    sets.push(sql`updated_by = ${userId}`);
    await db.execute(
      sql`UPDATE ${this.accounts}
          SET ${sql.join(sets, sql.raw(', '))}
          WHERE id = ${id}`,
    );
  }

  /**
   * GL history for one account — line + entry header, oldest first (ACC-2
   * order). Optional date-range filter + pagination. The running balance is a
   * window sum over the WHOLE filtered set (not just the page), so a page
   * slice always carries correct cumulative balances (the account-detail GL).
   */
  async findAccountMovements(
    accountId: string,
    filter: { fromDate?: string; toDate?: string; page?: number; pageSize?: number } = {},
    tx?: TxOrDb,
  ): Promise<PageResult<AccountMovementRow>> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conditions = [sql`jl.account_id = ${accountId}`];
    if (filter.fromDate) conditions.push(sql`e.entry_date >= ${filter.fromDate}::date`);
    if (filter.toDate) conditions.push(sql`e.entry_date <= ${filter.toDate}::date`);
    const where = sql.join(conditions, sql.raw(' AND '));

    const countRows = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM ${this.journalLines} jl
      JOIN ${this.journalEntries} e ON e.id = jl.entry_id
      WHERE ${where}
    `);
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT jl.id, jl.entry_id, jl.debit_amount_minor, jl.credit_amount_minor, jl.memo,
             e.entry_number, e.entry_date, e.description, e.status, e.posted_at,
             e.source_type, e.source_id,
             SUM(jl.debit_amount_minor - jl.credit_amount_minor) OVER (
               ORDER BY e.entry_date ASC, e.entry_number ASC, jl.created_at ASC
             )::text AS running_balance
      FROM ${this.journalLines} jl
      JOIN ${this.journalEntries} e ON e.id = jl.entry_id
      WHERE ${where}
      ORDER BY e.entry_date ASC, e.entry_number ASC, jl.created_at ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    return {
      items: rows.map((row) => ({
        id: row.id as string,
        entryId: row.entry_id as string,
        entryNumber: Number(row.entry_number),
        entryDate: row.entry_date as string,
        description: (row.description as string) ?? '',
        status: row.status as string,
        postedAt: row.posted_at ? new Date(row.posted_at as string).toISOString() : null,
        debitAmountMinor: this.minor(row, 'debit_amount_minor'),
        creditAmountMinor: this.minor(row, 'credit_amount_minor'),
        memo: (row.memo as string | null) ?? null,
        sourceType: (row.source_type as string) ?? 'manual',
        sourceId: (row.source_id as string | null) ?? null,
        runningBalanceMinor: this.minor(row, 'running_balance'),
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Σ debits / Σ credits of every journal line for the account (the balance). */
  async sumAccountBalances(accountId: string, tx?: TxOrDb): Promise<{ debitTotal: string; creditTotal: string }> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT COALESCE(SUM(debit_amount_minor), 0)::text AS debit_total,
             COALESCE(SUM(credit_amount_minor), 0)::text AS credit_total
      FROM ${this.journalLines}
      WHERE account_id = ${accountId}
    `);
    const row = rows[0];
    return {
      debitTotal: (row?.debit_total as string) ?? '0',
      creditTotal: (row?.credit_total as string) ?? '0',
    };
  }

  /**
   * Report aggregation: per-account debit/credit totals over a date range.
   * Every posted line counts (status untouched — reversals are themselves
   * balanced entries whose lines net the original naturally, ACC-2). Accounts
   * with no activity in the period are included with zero totals so the trial
   * balance lists the whole chart. RLS scopes to the org (fail-closed).
   */
  async sumAccountPeriodBalances(
    filter: { fromDate?: string; toDate?: string } = {},
    tx?: TxOrDb,
  ): Promise<AccountPeriodBalanceRow[]> {
    const db = this.getDb(tx);
    const conditions = [sql`TRUE`];
    if (filter.fromDate) conditions.push(sql`e.entry_date >= ${filter.fromDate}::date`);
    if (filter.toDate) conditions.push(sql`e.entry_date <= ${filter.toDate}::date`);
    const where = sql.join(conditions, sql.raw(' AND '));

    // The period filter is applied INSIDE the lines subquery so that lines
    // outside the range never join (accounts with no activity in the period
    // keep a zero-total row via the outer LEFT JOIN).
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.code, a.name_i18n, a.type, a.is_system, a.is_active,
             COALESCE(l.debit_total, 0)::text AS debit_total,
             COALESCE(l.credit_total, 0)::text AS credit_total
      FROM ${this.accounts} a
      LEFT JOIN (
        SELECT jl.account_id,
               SUM(jl.debit_amount_minor)  AS debit_total,
               SUM(jl.credit_amount_minor) AS credit_total
        FROM ${this.journalLines} jl
        JOIN ${this.journalEntries} e ON e.id = jl.entry_id
        WHERE ${where}
        GROUP BY jl.account_id
      ) l ON l.account_id = a.id
      WHERE a.deleted_at IS NULL
      GROUP BY a.id, a.code, a.name_i18n, a.type, a.is_system, a.is_active, l.debit_total, l.credit_total
      ORDER BY a.code ASC
    `);
    return rows.map((row) => ({
      id: row.id as string,
      code: row.code as string,
      nameI18n: this.jsonb(row, 'name_i18n'),
      type: row.type as string,
      isSystem: Boolean(row.is_system),
      isActive: Boolean(row.is_active),
      debitTotalMinor: this.minor(row, 'debit_total'),
      creditTotalMinor: this.minor(row, 'credit_total'),
    }));
  }

  /** Payments list — every receipt with its invoice, newest first (ACC-9). */
  async listPayments(filter: PaymentFilter = {}, tx?: TxOrDb): Promise<PageResult<PaymentListRow>> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conditions = [sql`TRUE`];
    if (filter.method) conditions.push(sql`p.method = ${filter.method}`);
    if (filter.fromDate) conditions.push(sql`p.received_at >= ${filter.fromDate}::date`);
    if (filter.toDate) conditions.push(sql`p.received_at < (${filter.toDate}::date + INTERVAL '1 day')`);
    if (filter.q) {
      // Search by customer name or invoice number (case-insensitive).
      const term = `%${filter.q.trim()}%`;
      conditions.push(sql`(i.customer_name_snapshot ILIKE ${term} OR i.invoice_number ILIKE ${term})`);
    }
    const where = sql.join(conditions, sql.raw(' AND '));

    const countRows = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM ${this.payments} p
      JOIN ${this.paymentAllocations} pa ON pa.payment_id = p.id
      JOIN ${this.invoices} i ON i.id = pa.invoice_id
      WHERE ${where}
    `);
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT p.id, p.method, p.receipt_number, p.amount_minor, p.currency, p.received_at,
             p.reference, p.created_by,
             i.id AS invoice_id, i.invoice_number, i.customer_name_snapshot,
             pa.amount_minor AS allocation_amount_minor
      FROM ${this.payments} p
      JOIN ${this.paymentAllocations} pa ON pa.payment_id = p.id
      JOIN ${this.invoices} i ON i.id = pa.invoice_id
      WHERE ${where}
      ORDER BY p.received_at DESC, p.created_at DESC, p.id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    return {
      items: rows.map((row) => ({
        id: row.id as string,
        method: row.method as string,
        receiptNumber: row.receipt_number as string,
        amountMinor: this.minor(row, 'amount_minor'),
        currency: row.currency as string,
        receivedAt: new Date(row.received_at as string).toISOString(),
        reference: (row.reference as string | null) ?? null,
        invoiceId: row.invoice_id as string,
        invoiceNumber: row.invoice_number as string,
        customerNameSnapshot: row.customer_name_snapshot as string,
        allocationAmountMinor: this.minor(row, 'allocation_amount_minor'),
        createdBy: (row.created_by as string | null) ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** The organization's seller tax ID (ACC-6) — core_organization_settings. */
  async getOrgSellerTaxId(tx?: TxOrDb): Promise<string | null> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT seller_tax_id FROM core_organization_settings LIMIT 1
    `);
    return (rows[0]?.seller_tax_id as string | null) ?? null;
  }

  /** One payment receipt with its allocation breakdown (ACC-9). */
  async getPayment(id: string, tx?: TxOrDb): Promise<PaymentDetailRow | undefined> {
    const db = this.getDb(tx);
    const paymentRows = await db.execute<Record<string, unknown>>(sql`
      SELECT p.id, p.method, p.receipt_number, p.amount_minor, p.currency, p.received_at,
             p.reference, p.created_by, p.created_at
      FROM ${this.payments} p
      WHERE p.id = ${id}
      LIMIT 1
    `);
    const row = paymentRows[0];
    if (!row) return undefined;

    const allocationRows = await db.execute<Record<string, unknown>>(sql`
      SELECT pa.id, i.id AS invoice_id, i.invoice_number, i.customer_name_snapshot,
             i.invoice_date, i.status AS invoice_status, pa.currency, pa.amount_minor
      FROM ${this.paymentAllocations} pa
      JOIN ${this.invoices} i ON i.id = pa.invoice_id
      WHERE pa.payment_id = ${id}
      ORDER BY i.invoice_number ASC
    `);

    return {
      id: row.id as string,
      method: row.method as string,
      receiptNumber: row.receipt_number as string,
      amountMinor: this.minor(row, 'amount_minor'),
      currency: row.currency as string,
      receivedAt: new Date(row.received_at as string).toISOString(),
      reference: (row.reference as string | null) ?? null,
      createdBy: (row.created_by as string | null) ?? null,
      createdAt: new Date(row.created_at as string).toISOString(),
      allocations: allocationRows.map((allocation): PaymentAllocationRow => ({
        id: allocation.id as string,
        invoiceId: allocation.invoice_id as string,
        invoiceNumber: allocation.invoice_number as string,
        customerNameSnapshot: allocation.customer_name_snapshot as string,
        invoiceDate: allocation.invoice_date as string,
        invoiceStatus: allocation.invoice_status as string,
        currency: allocation.currency as string,
        amountMinor: this.minor(allocation, 'amount_minor'),
      })),
    };
  }

  /** AR aging: every open invoice (issued / partially_paid / overdue), newest first. */
  async listOpenInvoices(tx?: TxOrDb): Promise<AgingInvoiceRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id, invoice_number, customer_name_snapshot, invoice_date, due_date, currency,
             total_amount_minor, paid_amount_minor, credited_amount_minor
      FROM ${this.invoices}
      WHERE deleted_at IS NULL
        AND status IN ('issued', 'partially_paid', 'overdue')
      ORDER BY due_date ASC, invoice_number ASC
    `);
    return rows.map((row) => ({
      id: row.id as string,
      invoiceNumber: row.invoice_number as string,
      customerNameSnapshot: row.customer_name_snapshot as string,
      invoiceDate: row.invoice_date as string,
      dueDate: row.due_date as string,
      currency: row.currency as string,
      totalAmountMinor: this.minor(row, 'total_amount_minor'),
      paidAmountMinor: this.minor(row, 'paid_amount_minor'),
      creditedAmountMinor: this.minor(row, 'credited_amount_minor'),
    }));
  }

  // ─── Tax rates (ACC-11) ────────────────────────────────────────────────

  async listTaxRates(tx?: TxOrDb): Promise<TaxRateRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.taxRates}
      WHERE deleted_at IS NULL
      ORDER BY rate_bp DESC, code ASC
    `);
    return rows.map((row) => this.rowToTaxRate(row));
  }

  async insertTaxRate(rate: TaxRateData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.taxRates}
        (id, organization_id, code, name_i18n, rate_bp, type, tax_basis, coa_account_id, is_default,
         effective_from, is_active, created_at, updated_at, created_by, updated_by)
      VALUES
        (${rate.id}, ${organizationId}, ${rate.code}, ${JSON.stringify(rate.nameI18n)}::jsonb,
         ${rate.rateBp}, ${rate.type}, ${rate.taxBasis}, ${rate.coaAccountId}, ${rate.isDefault},
         ${rate.effectiveFrom}, ${rate.isActive},
         ${toDbDate(new Date(rate.createdAt))}, ${toDbDate(new Date(rate.updatedAt))}, ${userId}, ${userId})
    `);
  }

  async findTaxRateById(id: string, tx?: TxOrDb): Promise<TaxRateRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.taxRates}
      WHERE id = ${id} AND deleted_at IS NULL
      LIMIT 1
    `);
    return rows[0] ? this.rowToTaxRate(rows[0]) : undefined;
  }

  /** ACC-11: the org's default rate (is_default), or undefined when none set. */
  async getDefaultTaxRate(tx?: TxOrDb): Promise<TaxRateRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.taxRates}
      WHERE is_default AND is_active AND deleted_at IS NULL
      ORDER BY effective_from DESC
      LIMIT 1
    `);
    return rows[0] ? this.rowToTaxRate(rows[0]) : undefined;
  }

  async updateTaxRate(id: string, patch: Partial<TaxRateData>, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      UPDATE ${this.taxRates}
      SET
        name_i18n = COALESCE(${JSON.stringify(patch.nameI18n ?? {})}::jsonb, name_i18n),
        rate_bp = COALESCE(${patch.rateBp ?? null}, rate_bp),
        type = COALESCE(${patch.type ?? null}, type),
        tax_basis = COALESCE(${patch.taxBasis ?? null}, tax_basis),
        coa_account_id = ${patch.coaAccountId === undefined ? sql`coa_account_id` : patch.coaAccountId},
        is_default = COALESCE(${patch.isDefault ?? null}, is_default),
        is_active = COALESCE(${patch.isActive ?? null}, is_active),
        updated_at = NOW(),
        updated_by = ${userId}
      WHERE id = ${id} AND organization_id = ${organizationId} AND deleted_at IS NULL
    `);
  }

  // ─── Journal (ACC-1/2/3/4) ─────────────────────────────────────────────

  /** ACC-3: bump the org counter inside the transaction; failed posts roll back. */
  async allocateEntryNumber(tx?: TxOrDb): Promise<number> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    await this.ensureOrgSettings(organizationId, db);
    const rows = await db.execute<Record<string, unknown>>(sql`
      UPDATE ${this.orgSettings}
      SET next_entry_number = next_entry_number + 1
      WHERE organization_id = ${organizationId}
      RETURNING next_entry_number AS n
    `);
    const row = rows[0];
    if (!row) throw new Error('allocateEntryNumber: org settings row missing');
    return Number(row.n);
  }

  async insertJournalEntry(entry: JournalEntryData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.journalEntries}
        (id, organization_id, entry_number, entry_date, description, currency, status,
         source_type, source_id, posted_at, posted_by, reversed_by_entry_id, idempotency_key,
         created_at, updated_at, created_by, updated_by)
      VALUES
        (${entry.id}, ${entry.organizationId}, ${entry.entryNumber}, ${entry.entryDate},
         ${entry.description}, ${entry.currency}, ${entry.status}, ${entry.sourceType},
         ${entry.sourceId}, ${entry.postedAt ? toDbDate(new Date(entry.postedAt)) : null},
         ${sanitizeActorId(entry.postedBy)}, ${entry.reversedByEntryId}, ${entry.idempotencyKey},
         ${toDbDate(new Date(entry.createdAt))}, ${toDbDate(new Date(entry.updatedAt))}, ${userId}, ${userId})
    `);
    for (const line of entry.lines) {
      await db.execute(sql`
        INSERT INTO ${this.journalLines}
          (id, organization_id, entry_id, account_id, debit_amount_minor, credit_amount_minor, memo,
           created_at, created_by)
        VALUES
          (${line.id}, ${entry.organizationId}, ${entry.id}, ${line.accountId},
           ${line.debitAmountMinor}, ${line.creditAmountMinor}, ${line.memo},
           ${toDbDate(new Date(entry.createdAt))}, ${userId})
      `);
    }
  }

  async findJournalEntryById(id: string, tx?: TxOrDb): Promise<JournalEntryRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.journalEntries} WHERE id = ${id} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.composeJournalEntry(row, db);
  }

  async findJournalEntryBySource(
    sourceType: string,
    sourceId: string,
    tx?: TxOrDb,
  ): Promise<JournalEntryRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.journalEntries} WHERE source_type = ${sourceType} AND source_id = ${sourceId} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.composeJournalEntry(row, db);
  }

  async findJournalEntryByIdempotencyKey(idempotencyKey: string, tx?: TxOrDb): Promise<JournalEntryRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.journalEntries} WHERE idempotency_key = ${idempotencyKey} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.composeJournalEntry(row, db);
  }

  /** ACC-2: mark a posted entry reversed (status + reversal pointer only). */
  async updateJournalEntryStatus(
    id: string,
    status: string,
    reversedByEntryId: string | null,
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(
      sql`UPDATE ${this.journalEntries}
          SET status = ${status},
              reversed_by_entry_id = ${reversedByEntryId},
              updated_at = NOW(), updated_by = ${userId}
          WHERE id = ${id}`,
    );
  }

  async listJournalEntries(filter: JournalFilter = {}, tx?: TxOrDb): Promise<PageResult<JournalEntryRow>> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conditions = [sql`TRUE`];
    if (filter.fromDate) conditions.push(sql`entry_date >= ${filter.fromDate}::date`);
    if (filter.toDate) conditions.push(sql`entry_date <= ${filter.toDate}::date`);
    // Source-document scoping (ACC-15): e.g. the AP entry posted for a bill.
    if (filter.sourceType) conditions.push(sql`source_type = ${filter.sourceType}`);
    if (filter.sourceId) conditions.push(sql`source_id = ${filter.sourceId}`);
    if (filter.q) {
      const term = filter.q.trim();
      // Search matches the description (case-insensitive) OR the entry number
      // (either a bare number `5` or the formatted `JE-0005` / `je-5`).
      const numberMatch = /^\d+$/.test(term) ? Number(term) : null;
      const jeMatch = /^je-?(\d+)$/i.exec(term);
      const entryNumber = numberMatch ?? (jeMatch ? Number(jeMatch[1]) : null);
      const searchConditions = [sql`description ILIKE ${`%${term}%`}`];
      if (entryNumber !== null) searchConditions.push(sql`entry_number = ${entryNumber}`);
      conditions.push(sql`(${sql.join(searchConditions, sql.raw(' OR '))})`);
    }
    const where = sql.join(conditions, sql.raw(' AND '));

    const countRows = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ${this.journalEntries} WHERE ${where}`,
    );
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.journalEntries}
      WHERE ${where}
      ORDER BY entry_number DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    if (rows.length === 0) return { items: [], total, page, pageSize };

    const entryIds = rows.map((r) => r.id as string);
    const lineRows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.journalLines}
      WHERE entry_id IN (${this.valueList(entryIds)})
      ORDER BY created_at ASC, id ASC
    `);
    const linesByEntry = groupBy(
      lineRows,
      (row) => row.entry_id as string,
      (row) => row,
    );

    return {
      items: rows.map((row) => this.composeJournalEntryWithLines(row, linesByEntry.get(row.id as string) ?? [])),
      total,
      page,
      pageSize,
    };
  }

  // ─── Invoices (ACC-6/7/8/9/13) ─────────────────────────────────────────

  /** ACC-3 pattern for documents: gap-free per-org invoice numbers. */
  async allocateInvoiceNumber(tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    await this.ensureOrgSettings(organizationId, db);
    const rows = await db.execute<Record<string, unknown>>(sql`
      UPDATE ${this.orgSettings}
      SET next_invoice_number = next_invoice_number + 1
      WHERE organization_id = ${organizationId}
      RETURNING next_invoice_number AS n
    `);
    const row = rows[0];
    if (!row) throw new Error('allocateInvoiceNumber: org settings row missing');
    return `INV-${String(Number(row.n)).padStart(6, '0')}`;
  }

  async insertInvoice(invoice: InvoiceData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.invoices}
        (id, organization_id, invoice_number, customer_contact_id, customer_company_id,
         customer_name_snapshot, customer_tax_id_snapshot, seller_tax_id, status,
         invoice_date, due_date, currency, exchange_rate, base_total_amount_minor,
         subtotal_amount_minor, discount_amount_minor, tax_amount_minor, total_amount_minor,
         locale, source_type, source_id, idempotency_key, e_invoice_uuid, e_invoice_hash,
         e_invoice_irn, e_invoice_qr, e_invoice_status, created_at, updated_at, created_by, updated_by)
      VALUES
        (${invoice.id}, ${invoice.organizationId}, ${invoice.invoiceNumber},
         ${invoice.customerContactId}, ${invoice.customerCompanyId},
         ${invoice.customerNameSnapshot}, ${invoice.customerTaxIdSnapshot}, ${invoice.sellerTaxId},
         ${invoice.status}, ${invoice.invoiceDate}, ${invoice.dueDate}, ${invoice.currency},
         ${invoice.exchangeRate}, ${invoice.baseTotalAmountMinor},
         ${invoice.subtotalAmountMinor}, ${invoice.discountAmountMinor}, ${invoice.taxAmountMinor},
         ${invoice.totalAmountMinor}, ${invoice.locale}, ${invoice.sourceType}, ${invoice.sourceId},
         ${invoice.idempotencyKey}, ${invoice.eInvoiceUuid}, ${invoice.eInvoiceHash},
         ${invoice.eInvoiceIrn}, ${invoice.eInvoiceQr}, ${invoice.eInvoiceStatus},
         ${toDbDate(new Date(invoice.createdAt))}, ${toDbDate(new Date(invoice.updatedAt))}, ${userId}, ${userId})
    `);
    for (const line of invoice.lines) {
      await db.execute(sql`
        INSERT INTO ${this.invoiceLines}
          (id, organization_id, invoice_id, variant_id, item_name_snapshot, description,
           quantity, unit_price_amount_minor, discount_amount_minor, tax_rate_id,
           tax_rate_bp_snapshot, tax_type_snapshot, tax_basis_snapshot, tax_amount_minor,
           line_total_amount_minor, is_goods, created_at, created_by)
        VALUES
          (${line.id}, ${invoice.organizationId}, ${invoice.id}, ${line.variantId},
           ${line.itemNameSnapshot}, ${line.description}, ${line.quantity},
           ${line.unitPriceAmountMinor}, ${line.discountAmountMinor}, ${line.taxRateId},
           ${line.taxRateBpSnapshot}, ${line.taxTypeSnapshot}, ${line.taxBasisSnapshot},
           ${line.taxAmountMinor}, ${line.lineTotalAmountMinor}, ${line.isGoods},
           ${toDbDate(new Date(invoice.createdAt))}, ${userId})
      `);
    }
  }

  async findInvoiceById(id: string, tx?: TxOrDb): Promise<InvoiceRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.invoices} WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.composeInvoice(row, db);
  }

  async findInvoiceByNumber(number: string, tx?: TxOrDb): Promise<InvoiceRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.invoices} WHERE invoice_number = ${number} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.composeInvoice(row, db);
  }

  async findInvoiceBySource(sourceType: string, sourceId: string, tx?: TxOrDb): Promise<InvoiceRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.invoices} WHERE source_type = ${sourceType} AND source_id = ${sourceId} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.composeInvoice(row, db);
  }

  async findInvoiceByIdempotencyKey(idempotencyKey: string, tx?: TxOrDb): Promise<InvoiceRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.invoices} WHERE idempotency_key = ${idempotencyKey} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.composeInvoice(row, db);
  }

  async updateInvoiceStatus(id: string, status: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(
      sql`UPDATE ${this.invoices}
          SET status = ${status}, updated_at = NOW(), updated_by = ${userId}
          WHERE id = ${id}`,
    );
  }

  /** ACC-9: persist the running paid amount (sum of allocations). */
  async updateInvoicePaidAmount(id: string, paidAmountMinor: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(
      sql`UPDATE ${this.invoices}
          SET paid_amount_minor = ${paidAmountMinor}, updated_at = NOW(), updated_by = ${userId}
          WHERE id = ${id}`,
    );
  }

  /** ACC-10: persist the running credited amount (sum of issued credit notes). */
  async updateInvoiceCreditedAmount(id: string, creditedAmountMinor: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(
      sql`UPDATE ${this.invoices}
          SET credited_amount_minor = ${creditedAmountMinor}, updated_at = NOW(), updated_by = ${userId}
          WHERE id = ${id}`,
    );
  }

  async listInvoices(filter: InvoiceFilter = {}, tx?: TxOrDb): Promise<PageResult<InvoiceRow>> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conditions = [sql`deleted_at IS NULL`];
    if (filter.status) conditions.push(sql`status = ${filter.status}`);
    if (filter.fromDate) conditions.push(sql`invoice_date >= ${filter.fromDate}::date`);
    if (filter.toDate) conditions.push(sql`invoice_date <= ${filter.toDate}::date`);
    if (filter.q) {
      // Search by invoice number or customer name (case-insensitive).
      const term = `%${filter.q.trim()}%`;
      conditions.push(sql`(invoice_number ILIKE ${term} OR customer_name_snapshot ILIKE ${term})`);
    }
    const where = sql.join(conditions, sql.raw(' AND '));

    const countRows = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ${this.invoices} WHERE ${where}`,
    );
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.invoices}
      WHERE ${where}
      ORDER BY invoice_date DESC, created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    if (rows.length === 0) return { items: [], total, page, pageSize };

    const invoiceIds = rows.map((r) => r.id as string);
    const lineRows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.invoiceLines}
      WHERE invoice_id IN (${this.valueList(invoiceIds)})
      ORDER BY created_at ASC, id ASC
    `);
    const linesByInvoice = groupBy(
      lineRows,
      (row) => row.invoice_id as string,
      (row) => row,
    );

    return {
      items: rows.map((row) => this.composeInvoiceWithLines(row, linesByInvoice.get(row.id as string) ?? [])),
      total,
      page,
      pageSize,
    };
  }

  // ─── Payments + allocations (ACC-9) ────────────────────────────────────

  async insertPayment(
    data: {
      id: string;
      organizationId: string;
      method: string;
      receiptNumber: string;
      amountMinor: string;
      currency: string;
      receivedAt: Date;
      reference: string | null;
      idempotencyKey: string | null;
    },
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.payments}
        (id, organization_id, method, receipt_number, amount_minor, currency, received_at,
         reference, idempotency_key, created_at, created_by)
      VALUES
        (${data.id}, ${data.organizationId}, ${data.method}, ${data.receiptNumber},
         ${data.amountMinor}, ${data.currency}, ${toDbDate(data.receivedAt)},
         ${data.reference}, ${data.idempotencyKey}, ${toDbDate(new Date())}, ${userId})
    `);
  }

  async insertPaymentAllocation(
    data: {
      id: string;
      organizationId: string;
      paymentId: string;
      invoiceId: string;
      amountMinor: string;
      currency: string;
    },
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.paymentAllocations}
        (id, organization_id, payment_id, invoice_id, amount_minor, currency, created_at, created_by)
      VALUES
        (${data.id}, ${data.organizationId}, ${data.paymentId}, ${data.invoiceId},
         ${data.amountMinor}, ${data.currency}, ${toDbDate(new Date())}, ${userId})
    `);
  }

  /** ACC-9: Σ allocations per invoice (minor units). */
  async sumAllocationsByInvoice(invoiceId: string, tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT COALESCE(SUM(amount_minor), 0)::text AS total
      FROM ${this.paymentAllocations}
      WHERE invoice_id = ${invoiceId}
    `);
    return (rows[0]?.total as string) ?? '0';
  }

  /** ACC-9: the payments allocated to one invoice, oldest first (timeline). */
  async listInvoicePayments(invoiceId: string, tx?: TxOrDb): Promise<InvoicePaymentRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT p.id, p.method, p.amount_minor, p.currency, p.received_at, p.reference, p.created_by,
             pa.amount_minor AS allocation_amount_minor
      FROM ${this.payments} p
      JOIN ${this.paymentAllocations} pa ON pa.payment_id = p.id
      WHERE pa.invoice_id = ${invoiceId}
      ORDER BY p.received_at ASC, p.created_at ASC
    `);
    return rows.map((row) => ({
      id: row.id as string,
      method: row.method as string,
      amountMinor: this.minor(row, 'amount_minor'),
      currency: (row.currency as string) ?? '',
      receivedAt: new Date(row.received_at as string).toISOString(),
      reference: (row.reference as string | null) ?? null,
      allocationAmountMinor: this.minor(row, 'allocation_amount_minor'),
      createdBy: (row.created_by as string | null) ?? null,
    }));
  }

  /** ACC-10: credit notes issued against one invoice, oldest first. */
  async listCreditNotesByInvoice(invoiceId: string, tx?: TxOrDb): Promise<InvoiceCreditNoteRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id, credit_note_number, status, reason_code, amount_minor, currency, issued_at, created_at
      FROM ${this.creditNotes}
      WHERE invoice_id = ${invoiceId} AND deleted_at IS NULL
      ORDER BY created_at ASC, id ASC
    `);
    return rows.map((row) => ({
      id: row.id as string,
      creditNoteNumber: row.credit_note_number as string,
      status: row.status as string,
      reasonCode: row.reason_code as string,
      amountMinor: this.minor(row, 'amount_minor'),
      currency: (row.currency as string) ?? '',
      issuedAt: row.issued_at ? new Date(row.issued_at as string).toISOString() : null,
      createdAt: new Date(row.created_at as string).toISOString(),
    }));
  }

  // ─── Credit notes (ACC-10) ─────────────────────────────────────────────

  async allocateCreditNoteNumber(tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    await this.ensureOrgSettings(organizationId, db);
    const rows = await db.execute<Record<string, unknown>>(sql`
      UPDATE ${this.orgSettings}
      SET next_credit_note_number = next_credit_note_number + 1
      WHERE organization_id = ${organizationId}
      RETURNING next_credit_note_number AS n
    `);
    const row = rows[0];
    if (!row) throw new Error('allocateCreditNoteNumber: org settings row missing');
    return `CN-${String(Number(row.n)).padStart(6, '0')}`;
  }

  /** ACC-3 pattern for receipts: gap-free per-org receipt numbers (ACC-9). */
  async allocateReceiptNumber(tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    await this.ensureOrgSettings(organizationId, db);
    const rows = await db.execute<Record<string, unknown>>(sql`
      UPDATE ${this.orgSettings}
      SET next_receipt_number = next_receipt_number + 1
      WHERE organization_id = ${organizationId}
      RETURNING next_receipt_number AS n
    `);
    const row = rows[0];
    if (!row) throw new Error('allocateReceiptNumber: org settings row missing');
    return `REC-${String(Number(row.n)).padStart(6, '0')}`;
  }

  /** ACC-10: every issued credit note with its invoice + customer, newest first. */
  async listCreditNotes(filter: CreditNoteFilter = {}, tx?: TxOrDb): Promise<PageResult<CreditNoteListRow>> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conditions = [sql`cn.deleted_at IS NULL`];
    if (filter.q) {
      // Search by credit-note number, invoice number, or customer name.
      const term = `%${filter.q.trim()}%`;
      conditions.push(
        sql`(cn.credit_note_number ILIKE ${term} OR cn.invoice_number ILIKE ${term} OR i.customer_name_snapshot ILIKE ${term})`,
      );
    }
    const where = sql.join(conditions, sql.raw(' AND '));

    const countRows = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM ${this.creditNotes} cn
      JOIN ${this.invoices} i ON i.id = cn.invoice_id
      WHERE ${where}
    `);
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT cn.id, cn.credit_note_number, cn.invoice_id, cn.invoice_number, cn.status,
             cn.reason_code, cn.amount_minor, cn.currency, cn.issued_at, cn.created_at,
             i.customer_name_snapshot
      FROM ${this.creditNotes} cn
      JOIN ${this.invoices} i ON i.id = cn.invoice_id
      WHERE ${where}
      ORDER BY cn.created_at DESC, cn.id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    return {
      items: rows.map((row) => ({
        id: row.id as string,
        creditNoteNumber: row.credit_note_number as string,
        invoiceId: row.invoice_id as string,
        invoiceNumber: row.invoice_number as string,
        customerNameSnapshot: row.customer_name_snapshot as string,
        status: row.status as string,
        reasonCode: row.reason_code as string,
        amountMinor: this.minor(row, 'amount_minor'),
        currency: row.currency as string,
        issuedAt: row.issued_at ? new Date(row.issued_at as string).toISOString() : null,
        createdAt: new Date(row.created_at as string).toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  /** One credit note with its reversed lines resolved to item names (ACC-10). */
  async getCreditNoteDetail(id: string, tx?: TxOrDb): Promise<CreditNoteDetailRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT cn.id, cn.credit_note_number, cn.invoice_id, cn.invoice_number, cn.status,
             cn.reason_code, cn.amount_minor, cn.currency, cn.issued_at, cn.created_at,
             i.customer_name_snapshot
      FROM ${this.creditNotes} cn
      JOIN ${this.invoices} i ON i.id = cn.invoice_id
      WHERE cn.id = ${id} AND cn.deleted_at IS NULL
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;

    const lineRows = await db.execute<Record<string, unknown>>(sql`
      SELECT cnl.id, cnl.invoice_line_id, cnl.quantity, cnl.unit_price_amount_minor,
             cnl.tax_amount_minor, cnl.line_total_amount_minor,
             il.item_name_snapshot
      FROM ${this.creditNoteLines} cnl
      JOIN ${this.invoiceLines} il ON il.id = cnl.invoice_line_id
      WHERE cnl.credit_note_id = ${id}
      ORDER BY cnl.created_at ASC, cnl.id ASC
    `);

    return {
      id: row.id as string,
      creditNoteNumber: row.credit_note_number as string,
      invoiceId: row.invoice_id as string,
      invoiceNumber: row.invoice_number as string,
      customerNameSnapshot: row.customer_name_snapshot as string,
      status: row.status as string,
      reasonCode: row.reason_code as string,
      amountMinor: this.minor(row, 'amount_minor'),
      currency: row.currency as string,
      issuedAt: row.issued_at ? new Date(row.issued_at as string).toISOString() : null,
      createdAt: new Date(row.created_at as string).toISOString(),
      lines: lineRows.map((line) => ({
        id: line.id as string,
        invoiceLineId: line.invoice_line_id as string,
        itemNameSnapshot: line.item_name_snapshot as string,
        quantity: this.decimal(line.quantity),
        unitPriceAmountMinor: this.minor(line, 'unit_price_amount_minor'),
        taxAmountMinor: this.minor(line, 'tax_amount_minor'),
        lineTotalAmountMinor: this.minor(line, 'line_total_amount_minor'),
      })),
    };
  }

  async insertCreditNote(note: CreditNoteData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.creditNotes}
        (id, organization_id, invoice_id, credit_note_number, invoice_number, status, reason_code,
         amount_minor, currency, issued_at, created_at, updated_at, created_by, updated_by)
      VALUES
        (${note.id}, ${note.organizationId}, ${note.invoiceId}, ${note.creditNoteNumber},
         ${note.invoiceNumber}, ${note.status}, ${note.reasonCode}, ${note.amountMinor}, ${note.currency},
         ${note.issuedAt ? toDbDate(new Date(note.issuedAt)) : null},
         ${toDbDate(new Date(note.createdAt))}, ${toDbDate(new Date(note.updatedAt))}, ${userId}, ${userId})
    `);
    for (const line of note.lines) {
      await db.execute(sql`
        INSERT INTO ${this.creditNoteLines}
          (id, organization_id, credit_note_id, invoice_line_id, quantity, unit_price_amount_minor,
           tax_amount_minor, line_total_amount_minor, created_at, created_by)
        VALUES
          (${line.id}, ${note.organizationId}, ${note.id}, ${line.invoiceLineId}, ${line.quantity},
           ${line.unitPriceAmountMinor}, ${line.taxAmountMinor}, ${line.lineTotalAmountMinor},
           ${toDbDate(new Date(note.createdAt))}, ${userId})
      `);
    }
  }

  async findCreditNoteById(id: string, tx?: TxOrDb): Promise<CreditNoteRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.creditNotes} WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.composeCreditNote(row, db);
  }

  /** ACC-10: Σ issued credit-note amounts per invoice. */
  async sumIssuedCreditNotesByInvoice(invoiceId: string, tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT COALESCE(SUM(amount_minor), 0)::text AS total
      FROM ${this.creditNotes}
      WHERE invoice_id = ${invoiceId} AND status = 'issued'
    `);
    return (rows[0]?.total as string) ?? '0';
  }

  // ─── Internal helpers ──────────────────────────────────────────────────

  /** Lazy-create the org settings row (ACC-3 counters live there). */
  private async ensureOrgSettings(organizationId: string, db: PostgresJsDatabase): Promise<void> {
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.orgSettings} (organization_id, created_at, updated_at, created_by, updated_by)
      VALUES (${organizationId}, NOW(), NOW(), ${userId}, ${userId})
      ON CONFLICT (organization_id) DO NOTHING
    `);
  }

  private async composeJournalEntry(row: Record<string, unknown>, db: PostgresJsDatabase): Promise<JournalEntryRow> {
    const entryId = row.id as string;
    const lineRows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.journalLines} WHERE entry_id = ${entryId} ORDER BY created_at ASC, id ASC`,
    );
    return this.composeJournalEntryWithLines(row, lineRows);
  }

  private composeJournalEntryWithLines(
    row: Record<string, unknown>,
    lineRows: Record<string, unknown>[],
  ): JournalEntryRow {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      entryNumber: Number(row.entry_number),
      entryDate: row.entry_date as string,
      description: (row.description as string) ?? '',
      currency: (row.currency as string) ?? '',
      status: row.status as JournalEntryRow['status'],
      sourceType: row.source_type as string,
      sourceId: (row.source_id as string | null) ?? null,
      postedAt: row.posted_at ? new Date(row.posted_at as string).toISOString() : null,
      postedBy: (row.posted_by as string | null) ?? null,
      reversedByEntryId: (row.reversed_by_entry_id as string | null) ?? null,
      idempotencyKey: (row.idempotency_key as string | null) ?? null,
      createdAt: fromDbDate(row.created_at)?.toISOString() ?? new Date(0).toISOString(),
      updatedAt: fromDbDate(row.updated_at)?.toISOString() ?? new Date(0).toISOString(),
      createdBy: (row.created_by as string | null) ?? null,
      lines: lineRows.map((line) => ({
        id: line.id as string,
        entryId: line.entry_id as string,
        organizationId: line.organization_id as string,
        accountId: line.account_id as string,
        debitAmountMinor: this.minor(line, 'debit_amount_minor'),
        creditAmountMinor: this.minor(line, 'credit_amount_minor'),
        memo: (line.memo as string | null) ?? null,
      })),
    };
  }

  private async composeInvoice(row: Record<string, unknown>, db: PostgresJsDatabase): Promise<InvoiceRow> {
    const invoiceId = row.id as string;
    const lineRows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.invoiceLines} WHERE invoice_id = ${invoiceId} ORDER BY created_at ASC, id ASC`,
    );
    return this.composeInvoiceWithLines(row, lineRows);
  }

  private composeInvoiceWithLines(row: Record<string, unknown>, lineRows: Record<string, unknown>[]): InvoiceRow {
    const base = this.rowToInvoice(row);
    return {
      ...base,
      lines: lineRows.map((line) => ({
        id: line.id as string,
        invoiceId: line.invoice_id as string,
        organizationId: line.organization_id as string,
        variantId: (line.variant_id as string | null) ?? null,
        itemNameSnapshot: line.item_name_snapshot as string,
        description: (line.description as string | null) ?? null,
        quantity: this.decimal(line.quantity),
        unitPriceAmountMinor: this.minor(line, 'unit_price_amount_minor'),
        discountAmountMinor: this.minor(line, 'discount_amount_minor'),
        taxRateId: (line.tax_rate_id as string | null) ?? null,
        taxRateBpSnapshot: Number(line.tax_rate_bp_snapshot ?? 0),
        taxTypeSnapshot: line.tax_type_snapshot as string,
        taxBasisSnapshot: (line.tax_basis_snapshot as InvoiceLineData['taxBasisSnapshot']) ?? 'exclusive',
        taxAmountMinor: this.minor(line, 'tax_amount_minor'),
        lineTotalAmountMinor: this.minor(line, 'line_total_amount_minor'),
        isGoods: Boolean(line.is_goods),
      })),
    };
  }

  private rowToInvoice(row: Record<string, unknown>): Omit<InvoiceRow, 'lines'> {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      invoiceNumber: row.invoice_number as string,
      customerContactId: (row.customer_contact_id as string | null) ?? null,
      customerCompanyId: (row.customer_company_id as string | null) ?? null,
      customerNameSnapshot: row.customer_name_snapshot as string,
      customerTaxIdSnapshot: (row.customer_tax_id_snapshot as string | null) ?? null,
      sellerTaxId: (row.seller_tax_id as string | null) ?? null,
      status: row.status as InvoiceRow['status'],
      invoiceDate: row.invoice_date as string,
      dueDate: row.due_date as string,
      currency: (row.currency as string) ?? '',
      exchangeRate: this.nullableMinor(row, 'exchange_rate'),
      baseTotalAmountMinor: this.nullableMinor(row, 'base_total_amount_minor'),
      subtotalAmountMinor: this.minor(row, 'subtotal_amount_minor'),
      discountAmountMinor: this.minor(row, 'discount_amount_minor'),
      taxAmountMinor: this.minor(row, 'tax_amount_minor'),
      totalAmountMinor: this.minor(row, 'total_amount_minor'),
      locale: (row.locale as string) ?? 'en',
      sourceType: row.source_type as InvoiceRow['sourceType'],
      sourceId: (row.source_id as string | null) ?? null,
      idempotencyKey: (row.idempotency_key as string | null) ?? null,
      eInvoiceUuid: (row.e_invoice_uuid as string | null) ?? null,
      eInvoiceHash: (row.e_invoice_hash as string | null) ?? null,
      eInvoiceIrn: (row.e_invoice_irn as string | null) ?? null,
      eInvoiceQr: (row.e_invoice_qr as string | null) ?? null,
      eInvoiceStatus: (row.e_invoice_status as string | null) ?? null,
      createdAt: fromDbDate(row.created_at)?.toISOString() ?? new Date(0).toISOString(),
      updatedAt: fromDbDate(row.updated_at)?.toISOString() ?? new Date(0).toISOString(),
      paidAmountMinor: this.minor(row, 'paid_amount_minor'),
      creditedAmountMinor: this.minor(row, 'credited_amount_minor'),
    };
  }

  private async composeCreditNote(row: Record<string, unknown>, db: PostgresJsDatabase): Promise<CreditNoteRow> {
    const noteId = row.id as string;
    const lineRows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.creditNoteLines} WHERE credit_note_id = ${noteId} ORDER BY created_at ASC, id ASC`,
    );
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      invoiceId: row.invoice_id as string,
      invoiceNumber: row.invoice_number as string,
      creditNoteNumber: row.credit_note_number as string,
      status: row.status as CreditNoteRow['status'],
      reasonCode: row.reason_code as string,
      amountMinor: this.minor(row, 'amount_minor'),
      currency: (row.currency as string) ?? '',
      issuedAt: row.issued_at ? new Date(row.issued_at as string).toISOString() : null,
      createdAt: fromDbDate(row.created_at)?.toISOString() ?? new Date(0).toISOString(),
      updatedAt: fromDbDate(row.updated_at)?.toISOString() ?? new Date(0).toISOString(),
      lines: lineRows.map((line) => ({
        id: line.id as string,
        creditNoteId: line.credit_note_id as string,
        organizationId: line.organization_id as string,
        invoiceLineId: line.invoice_line_id as string,
        quantity: this.decimal(line.quantity),
        unitPriceAmountMinor: this.minor(line, 'unit_price_amount_minor'),
        taxAmountMinor: this.minor(line, 'tax_amount_minor'),
        lineTotalAmountMinor: this.minor(line, 'line_total_amount_minor'),
      })),
    };
  }

  private rowToAccount(row: Record<string, unknown>): AccountRow {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      code: row.code as string,
      nameI18n: this.jsonb(row, 'name_i18n'),
      type: row.type as AccountRow['type'],
      parentId: (row.parent_id as string | null) ?? null,
      isSystem: Boolean(row.is_system),
      isActive: Boolean(row.is_active),
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      deletedAt: fromDbDate(row.deleted_at),
    };
  }

  private rowToTaxRate(row: Record<string, unknown>): TaxRateRow {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      code: row.code as string,
      nameI18n: this.jsonb(row, 'name_i18n'),
      rateBp: Number(row.rate_bp ?? 0),
      type: row.type as TaxRateRow['type'],
      taxBasis: (row.tax_basis as TaxRateRow['taxBasis']) ?? 'exclusive',
      coaAccountId: (row.coa_account_id as string | null) ?? null,
      isDefault: Boolean(row.is_default),
      effectiveFrom: row.effective_from as string,
      isActive: Boolean(row.is_active),
    };
  }
}

/** Group rows by a key (batch child reads for paginated lists). */
function groupBy<T>(
  rows: Record<string, unknown>[],
  keyOf: (row: Record<string, unknown>) => string,
  map: (row: Record<string, unknown>) => T,
): Map<string, T[]> {
  const mapOut = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = mapOut.get(key) ?? [];
    list.push(map(row));
    mapOut.set(key, list);
  }
  return mapOut;
}
