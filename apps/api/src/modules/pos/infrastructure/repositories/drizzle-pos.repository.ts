import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { TenantContext } from '../../../../core/tenancy/tenant-context.js';
import {
  type SalesListPage,
  type PaymentRow,
  type PosRepository,
  type RefundLineRow,
  type RefundRow,
  type RegisterRow,
  type SaleLineRow,
  type SaleListFilter,
  type ShiftListFilter,
  type ShiftSummaryRow,
  type SaleRow,
  type ShiftRow,
  type SyncLogRow,
} from '../../application/ports/index.js';
import { PosError, POS_ERROR_CODE, type RefundData, type SaleData, type ShiftData } from '../../domain/index.js';

/** postgres.js error code for a unique constraint violation. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * DrizzlePosRepository — Drizzle implementation of PosRepository.
 *
 * RLS scopes every query to the current organization (fail-closed), so no
 * manual organization_id filters are used (hard rule #2). Inserts populate
 * organization_id from TenantContext, never from client input.
 *
 * Ledger discipline (hard rule #8): pos_payments is append-only — this
 * repository never UPDATEs or DELETEs a payment row.
 */
@Injectable()
export class DrizzlePosRepository implements PosRepository {
  private readonly registers = sql.identifier('pos_registers');
  private readonly shifts = sql.identifier('pos_shifts');
  private readonly sales = sql.identifier('pos_sales');
  private readonly saleLines = sql.identifier('pos_sale_lines');
  private readonly payments = sql.identifier('pos_payments');
  private readonly refunds = sql.identifier('pos_refunds');
  private readonly refundLines = sql.identifier('pos_refund_lines');
  private readonly syncLog = sql.identifier('pos_sync_log');

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

  // ─── Registers (POS-1) ──────────────────────────────────────────────────

  async listRegisters(tx?: TxOrDb): Promise<RegisterRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT
        r.*,
        (SELECT s.id FROM ${this.shifts} s
          WHERE s.register_id = r.id AND s.status = 'open' LIMIT 1) AS open_shift_id
      FROM ${this.registers} r
      WHERE r.deleted_at IS NULL
      ORDER BY r.created_at ASC
    `);
    return rows.map((row) => this.rowToRegister(row));
  }

  async findRegisterById(id: string, tx?: TxOrDb): Promise<RegisterRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT
        r.*,
        (SELECT s.id FROM ${this.shifts} s
          WHERE s.register_id = r.id AND s.status = 'open' LIMIT 1) AS open_shift_id
      FROM ${this.registers} r
      WHERE r.id = ${id} AND r.deleted_at IS NULL LIMIT 1
    `);
    const row = rows[0];
    return row ? this.rowToRegister(row) : undefined;
  }

  async insertRegister(
    data: { id: string; name: string; code: string; warehouseId: string },
    tx?: TxOrDb,
  ): Promise<RegisterRow> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();
    try {
      const rows = await db.execute<Record<string, unknown>>(sql`
        INSERT INTO ${this.registers}
          (id, organization_id, name, code, warehouse_id, receipt_prefix,
           next_receipt_number, is_active, created_at, updated_at, created_by, updated_by)
        VALUES
          (${data.id}, ${organizationId}, ${data.name}, ${data.code}, ${data.warehouseId}, 'R',
           0, true, ${toDbDate(now)}, ${toDbDate(now)}, ${userId}, ${userId})
        RETURNING *
      `);
      const row = rows[0];
      if (!row) throw new Error('INSERT pos_registers RETURNING returned no rows');
      return this.rowToRegister(row);
    } catch (err) {
      if (this.isUniqueViolation(err, 'uq_pos_registers_org_code')) {
        throw new PosError(POS_ERROR_CODE.REGISTER_DUPLICATE_CODE, 'A register with this code already exists.');
      }
      throw err;
    }
  }

  // ─── Shifts (POS-2, POS-4, POS-5, POS-7) ────────────────────────────────

  async findOpenShiftByRegister(registerId: string, tx?: TxOrDb): Promise<ShiftRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.shifts} WHERE register_id = ${registerId} AND status = 'open' LIMIT 1`,
    );
    const row = rows[0];
    return row ? this.rowToShift(row) : undefined;
  }

  async findShiftById(id: string, tx?: TxOrDb): Promise<ShiftRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`SELECT * FROM ${this.shifts} WHERE id = ${id} LIMIT 1`);
    const row = rows[0];
    return row ? this.rowToShift(row) : undefined;
  }

  async listShifts(filter: ShiftListFilter = {}, tx?: TxOrDb): Promise<ShiftSummaryRow[]> {
    const db = this.getDb(tx);
    const conditions = [sql`TRUE`];
    if (filter.fromDate) conditions.push(sql`opened_at >= ${filter.fromDate}::date`);
    if (filter.toDate) {
      // Inclusive: a shift opened on toDate itself still matches.
      conditions.push(sql`opened_at < (${filter.toDate}::date + interval '1 day')`);
    }
    const where = sql.join(conditions, sql.raw(' AND '));
    // Per-shift aggregates (POS-8 semantics): count + Σ sale totals and
    // Σ refund amounts. The LEFT JOINs are RLS-scoped like every read, so a
    // shift can never leak another org's sales/refunds.
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT s.*,
        COALESCE(sales_agg.sales_count, 0) AS sales_count,
        COALESCE(sales_agg.sales_total, 0)::text AS sales_total,
        COALESCE(refunds_agg.refunds_total, 0)::text AS refunds_total
      FROM ${this.shifts} s
      LEFT JOIN (
        SELECT shift_id, count(*)::int AS sales_count, SUM(total_amount_minor) AS sales_total
        FROM ${this.sales}
        GROUP BY shift_id
      ) sales_agg ON sales_agg.shift_id = s.id
      LEFT JOIN (
        SELECT shift_id, SUM(amount_minor) AS refunds_total
        FROM ${this.refunds}
        GROUP BY shift_id
      ) refunds_agg ON refunds_agg.shift_id = s.id
      WHERE ${where}
      ORDER BY s.opened_at DESC, s.id DESC
    `);
    return rows.map((row) => ({
      ...this.rowToShift(row),
      salesCount: Number(row.sales_count ?? 0),
      // The aggregate columns are `::text`-cast in SQL, so they read back as
      // strings (same pattern as sumCashSalesByShift).
      salesAmountMinor: (row.sales_total as string) ?? '0',
      refundsAmountMinor: (row.refunds_total as string) ?? '0',
    }));
  }

  async insertShift(shift: ShiftData, tx?: TxOrDb): Promise<ShiftRow> {
    const db = this.getDb(tx);
    const userId = TenantContext.getUserId() ?? null;
    try {
      const rows = await db.execute<Record<string, unknown>>(sql`
        INSERT INTO ${this.shifts}
          (id, organization_id, register_id, opened_by, opened_at, opening_float_amount_minor,
           closed_by, closed_at, counted_cash_amount_minor, expected_cash_amount_minor,
           variance_amount_minor, currency, status, forced_close, created_at, updated_at, created_by, updated_by)
        VALUES
          (${shift.id}, ${shift.organizationId}, ${shift.registerId}, ${shift.openedBy}, ${toDbDate(shift.openedAt)},
           ${shift.openingFloatAmountMinor}, NULL, NULL, NULL, NULL, NULL,
           ${shift.currency}, ${shift.status}, false, ${toDbDate(shift.createdAt)}, ${toDbDate(shift.updatedAt)},
           ${userId}, ${userId})
        RETURNING *
      `);
      const row = rows[0];
      if (!row) throw new Error('INSERT pos_shifts RETURNING returned no rows');
      return this.rowToShift(row);
    } catch (err) {
      // POS-2: the partial unique index rejects a second open shift, even under
      // concurrency — surface it as the domain error.
      if (this.isUniqueViolation(err, 'uq_pos_shifts_open')) {
        throw new PosError(POS_ERROR_CODE.SHIFT_ALREADY_OPEN, 'A shift is already open on this register (POS-2).', {
          registerId: shift.registerId,
        });
      }
      throw err;
    }
  }

  async updateShiftClosed(shift: ShiftData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = TenantContext.getUserId() ?? null;
    await db.execute(
      sql`UPDATE ${this.shifts}
          SET status = ${shift.status}, closed_by = ${shift.closedBy}, closed_at = ${toDbDate(shift.closedAt)},
              counted_cash_amount_minor = ${shift.countedCashAmountMinor},
              expected_cash_amount_minor = ${shift.expectedCashAmountMinor},
              variance_amount_minor = ${shift.varianceAmountMinor},
              forced_close = ${shift.forcedClose},
              updated_at = ${toDbDate(shift.updatedAt)}, updated_by = ${userId}
          WHERE id = ${shift.id}`,
    );
  }

  async hasUnsyncedSalesInShift(shiftId: string, tx?: TxOrDb): Promise<boolean> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT EXISTS (SELECT 1 FROM ${this.sales} WHERE shift_id = ${shiftId} AND synced_at IS NULL) AS has_unsynced`,
    );
    return Boolean(rows[0]?.has_unsynced);
  }

  // ─── Sales (POS-9, POS-10, POS-26) ──────────────────────────────────────

  async allocateReceiptNumber(registerId: string, tx?: TxOrDb): Promise<number> {
    const db = this.getDb(tx);
    const userId = TenantContext.getUserId() ?? null;
    // POS-9: atomic, gap-free allocation. The sequence is bumped inside the
    // same transaction that inserts the sale — a failed sale never consumes a
    // number (the row update rolls back with the tx).
    const rows = await db.execute<Record<string, unknown>>(sql`
      UPDATE ${this.registers}
      SET next_receipt_number = next_receipt_number + 1,
          updated_at = NOW(), updated_by = ${userId}
      WHERE id = ${registerId} AND deleted_at IS NULL
      RETURNING next_receipt_number AS sequence
    `);
    const row = rows[0];
    if (!row) throw new Error('allocateReceiptNumber: register not found or inactive');
    return Number(row.sequence);
  }

  async findSaleById(id: string, tx?: TxOrDb): Promise<SaleRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`SELECT * FROM ${this.sales} WHERE id = ${id} LIMIT 1`);
    const row = rows[0];
    if (!row) return undefined;
    return this.composeSale(row, db);
  }

  async findSaleByIdempotencyKey(idempotencyKey: string, tx?: TxOrDb): Promise<SaleRow | undefined> {
    const db = this.getDb(tx);
    // POS-26: the unique index makes a retried sync a replay, never a duplicate.
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.sales} WHERE idempotency_key = ${idempotencyKey} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.composeSale(row, db);
  }

  async listSales(filter: SaleListFilter = {}, tx?: TxOrDb): Promise<SalesListPage> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 12));
    const offset = (page - 1) * pageSize;

    const conditions = [sql`TRUE`];
    // Multi-status (POS-13) — a revenue-style filter passes the statuses to
    // include (e.g. completed + partially_refunded) so voided/refunded sales
    // drop out of the count AND the exact Σ.
    if (filter.statuses && filter.statuses.length > 0) {
      conditions.push(sql`s.status IN (${this.valueList(filter.statuses)})`);
    }
    if (filter.shiftId) conditions.push(sql`s.shift_id = ${filter.shiftId}`);
    if (filter.registerId) conditions.push(sql`s.register_id = ${filter.registerId}`);
    if (filter.fromDate) conditions.push(sql`s.sold_at >= ${filter.fromDate}::date`);
    if (filter.toDate) {
      // Inclusive: a sale sold on toDate itself still matches.
      conditions.push(sql`s.sold_at < (${filter.toDate}::date + interval '1 day')`);
    }
    const where = sql.join(conditions, sql.raw(' AND '));

    const countRows = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ${this.sales} s WHERE ${where}`,
    );
    const total = Number(countRows[0]?.n ?? 0);

    // Exact Σ of the MATCHING set (ignoring pagination) so the reports page
    // can show filtered totals — same WHERE as the count and the page query.
    const sumRows = await db.execute<Record<string, unknown>>(
      sql`SELECT COALESCE(SUM(total_amount_minor), 0)::text AS total FROM ${this.sales} s WHERE ${where}`,
    );
    const totalAmountMinor = (sumRows[0]?.total as string) ?? '0';

    // Net revenue (dashboard): Σ refunds issued in the same window against
    // sales matching the filter. Joining the original sale keeps the statuses
    // semantic — a fully-refunded sale ('refunded') drops out of BOTH this Σ
    // and the revenue Σ, so a sale refunded in the same period nets to 0. A
    // sale fully refunded in a later period is not netted retroactively (no
    // sale-status history exists to attribute it).
    const refundConditions = [sql`TRUE`];
    if (filter.statuses && filter.statuses.length > 0) {
      refundConditions.push(sql`s.status IN (${this.valueList(filter.statuses)})`);
    }
    if (filter.shiftId) refundConditions.push(sql`s.shift_id = ${filter.shiftId}`);
    if (filter.registerId) refundConditions.push(sql`s.register_id = ${filter.registerId}`);
    if (filter.fromDate) refundConditions.push(sql`r.refunded_at >= ${filter.fromDate}::date`);
    if (filter.toDate) {
      // Inclusive: a refund issued on toDate itself still matches.
      refundConditions.push(sql`r.refunded_at < (${filter.toDate}::date + interval '1 day')`);
    }
    const refundWhere = sql.join(refundConditions, sql.raw(' AND '));
    const refundRows = await db.execute<Record<string, unknown>>(sql`
      SELECT COALESCE(SUM(r.amount_minor), 0)::text AS total
      FROM ${this.refunds} r
      JOIN ${this.sales} s ON s.id = r.original_sale_id
      WHERE ${refundWhere}
    `);
    const refundsAmountMinor = (refundRows[0]?.total as string) ?? '0';

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.sales} s
      WHERE ${where}
      ORDER BY s.sold_at DESC, s.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    if (rows.length === 0) return { items: [], total, totalAmountMinor, refundsAmountMinor, page, pageSize };

    const saleIds = rows.map((r) => r.id as string);
    const [lineRows, paymentRows] = await Promise.all([
      db.execute<Record<string, unknown>>(sql`
        SELECT * FROM ${this.saleLines}
        WHERE sale_id IN (${this.valueList(saleIds)}) ORDER BY created_at ASC, id ASC
      `),
      db.execute<Record<string, unknown>>(sql`
        SELECT * FROM ${this.payments}
        WHERE sale_id IN (${this.valueList(saleIds)}) ORDER BY captured_at ASC, id ASC
      `),
    ]);
    const linesBySale = groupBy(
      lineRows,
      (row) => row.sale_id as string,
      (row) => this.rowToSaleLine(row),
    );
    const paymentsBySale = groupBy(
      paymentRows,
      (row) => row.sale_id as string,
      (row) => this.rowToPayment(row),
    );

    return {
      items: rows.map((row) => ({
        ...this.rowToSale(row),
        lines: linesBySale.get(row.id as string) ?? [],
        payments: paymentsBySale.get(row.id as string) ?? [],
      })),
      total,
      totalAmountMinor,
      refundsAmountMinor,
      page,
      pageSize,
    };
  }

  async listSalesByShift(shiftId: string, tx?: TxOrDb): Promise<SaleRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.sales} WHERE shift_id = ${shiftId} ORDER BY sold_at ASC, id ASC`,
    );
    return Promise.all(rows.map((row) => this.composeSale(row, db)));
  }

  async insertSale(sale: SaleData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = TenantContext.getUserId() ?? null;
    await db.execute(sql`
      INSERT INTO ${this.sales}
        (id, organization_id, shift_id, register_id, receipt_number, customer_contact_id, status,
         subtotal_amount_minor, discount_amount_minor, tax_amount_minor, total_amount_minor, currency,
         exchange_rate, base_total_amount_minor, locale, idempotency_key, sold_at, synced_at,
         client_device_id, created_at, updated_at, created_by, updated_by)
      VALUES
        (${sale.id}, ${sale.organizationId}, ${sale.shiftId}, ${sale.registerId}, ${sale.receiptNumber},
         ${sale.customerContactId}, ${sale.status}, ${sale.subtotalAmountMinor}, ${sale.discountAmountMinor},
         ${sale.taxAmountMinor}, ${sale.totalAmountMinor}, ${sale.currency}, ${sale.exchangeRate},
         ${sale.baseTotalAmountMinor}, ${sale.locale}, ${sale.idempotencyKey}, ${toDbDate(sale.soldAt)},
         ${sale.syncedAt ? toDbDate(sale.syncedAt) : null}, ${sale.clientDeviceId},
         ${toDbDate(sale.createdAt)}, ${toDbDate(sale.updatedAt)}, ${sale.createdBy}, ${sale.updatedBy})
    `);

    for (const line of sale.lines) {
      await db.execute(sql`
        INSERT INTO ${this.saleLines}
          (id, organization_id, sale_id, variant_id, sku_snapshot, name_snapshot, quantity,
           unit_price_amount_minor, line_discount_amount_minor, tax_rate_bp, tax_amount_minor,
           line_total_amount_minor, currency, created_at, created_by)
        VALUES
          (${line.id}, ${sale.organizationId}, ${sale.id}, ${line.variantId}, ${line.skuSnapshot},
           ${JSON.stringify(line.nameSnapshot)}::jsonb, ${line.quantity}, ${line.unitPriceAmountMinor},
           ${line.lineDiscountAmountMinor}, ${line.taxRateBp}, ${line.taxAmountMinor},
           ${line.lineTotalAmountMinor}, ${line.currency}, ${toDbDate(sale.createdAt)}, ${sale.createdBy})
      `);
    }

    for (const payment of sale.payments) {
      await db.execute(sql`
        INSERT INTO ${this.payments}
          (id, organization_id, sale_id, method, amount_minor, currency, tendered_amount_minor,
           change_amount_minor, reference, captured_at, created_at, created_by)
        VALUES
          (${payment.id}, ${sale.organizationId}, ${sale.id}, ${payment.method}, ${payment.amountMinor},
           ${payment.currency}, ${payment.tenderedAmountMinor}, ${payment.changeAmountMinor},
           ${payment.reference}, ${toDbDate(payment.capturedAt)}, ${toDbDate(sale.createdAt)}, ${sale.createdBy})
      `);
    }
  }

  async updateSaleStatus(id: string, status: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = TenantContext.getUserId() ?? null;
    await db.execute(
      sql`UPDATE ${this.sales}
          SET status = ${status}, updated_at = NOW(), updated_by = ${userId}
          WHERE id = ${id}`,
    );
  }

  async sumCashSalesByShift(shiftId: string, tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT COALESCE(SUM(p.amount_minor), 0)::text AS total
      FROM ${this.payments} p
      JOIN ${this.sales} s ON s.id = p.sale_id
      WHERE s.shift_id = ${shiftId} AND p.method = 'cash'
    `);
    return (rows[0]?.total as string) ?? '0';
  }

  // ─── Payments (append-only reads) ───────────────────────────────────────

  async listPaymentsBySale(saleId: string, tx?: TxOrDb): Promise<PaymentRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.payments} WHERE sale_id = ${saleId} ORDER BY captured_at ASC, id ASC`,
    );
    return rows.map((row) => this.rowToPayment(row));
  }

  // ─── Refunds (POS-20, POS-21, POS-22, POS-23) ───────────────────────────

  async findSaleLineById(id: string, tx?: TxOrDb): Promise<SaleLineRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.saleLines} WHERE id = ${id} LIMIT 1`,
    );
    const row = rows[0];
    return row ? this.rowToSaleLine(row) : undefined;
  }

  async insertRefund(refund: RefundData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`
      INSERT INTO ${this.refunds}
        (id, organization_id, original_sale_id, shift_id, register_id, reason_code,
         amount_minor, currency, refunded_at, created_at, created_by)
      VALUES
        (${refund.id}, ${refund.organizationId}, ${refund.originalSaleId}, ${refund.shiftId},
         ${refund.registerId}, ${refund.reasonCode}, ${refund.amountMinor}, ${refund.currency},
         ${toDbDate(refund.refundedAt)}, ${toDbDate(refund.createdAt)}, ${refund.createdBy})
    `);
    for (const line of refund.lines) {
      await db.execute(sql`
        INSERT INTO ${this.refundLines}
          (id, organization_id, refund_id, sale_line_id, variant_id, quantity, restock,
           amount_minor, currency, created_at, created_by)
        VALUES
          (${line.id}, ${refund.organizationId}, ${refund.id}, ${line.saleLineId}, ${line.variantId},
           ${line.quantity}, ${line.restock}, ${line.amountMinor}, ${line.currency},
           ${toDbDate(refund.createdAt)}, ${refund.createdBy})
      `);
    }
  }

  async findRefundById(id: string, tx?: TxOrDb): Promise<RefundRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`SELECT * FROM ${this.refunds} WHERE id = ${id} LIMIT 1`);
    const row = rows[0];
    if (!row) return undefined;
    return this.composeRefund(row, db);
  }

  async findRefundLinesByRefund(refundId: string, tx?: TxOrDb): Promise<RefundLineRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.refundLines} WHERE refund_id = ${refundId} ORDER BY created_at ASC, id ASC`,
    );
    return rows.map((row) => this.rowToRefundLine(row));
  }

  async listRefundsBySale(saleId: string, tx?: TxOrDb): Promise<RefundRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.refunds} WHERE original_sale_id = ${saleId} ORDER BY refunded_at ASC, id ASC`,
    );
    return Promise.all(rows.map((row) => this.composeRefund(row, db)));
  }

  async listRefundsByShift(shiftId: string, tx?: TxOrDb): Promise<RefundRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.refunds} WHERE shift_id = ${shiftId} ORDER BY refunded_at ASC, id ASC`,
    );
    return Promise.all(rows.map((row) => this.composeRefund(row, db)));
  }

  async sumRefundsByShift(shiftId: string, tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT COALESCE(SUM(amount_minor), 0)::text AS total FROM ${this.refunds} WHERE shift_id = ${shiftId}`,
    );
    return (rows[0]?.total as string) ?? '0';
  }

  async cumulativeRefundedQuantityByLine(saleLineId: string, tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT COALESCE(SUM(rl.quantity), 0)::text AS total
      FROM ${this.refundLines} rl
      JOIN ${this.refunds} r ON r.id = rl.refund_id
      WHERE rl.sale_line_id = ${saleLineId}
    `);
    return this.decimal(rows[0]?.total);
  }

  async cumulativeRefundedAmountBySale(saleId: string, tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT COALESCE(SUM(amount_minor), 0)::text AS total FROM ${this.refunds} WHERE original_sale_id = ${saleId}`,
    );
    return (rows[0]?.total as string) ?? '0';
  }

  // ─── Sync log (POS-26, POS-29) ──────────────────────────────────────────

  async findSyncLogByIdempotencyKey(idempotencyKey: string, tx?: TxOrDb): Promise<SyncLogRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.syncLog} WHERE idempotency_key = ${idempotencyKey} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      clientDeviceId: row.client_device_id as string,
      idempotencyKey: row.idempotency_key as string,
      payload: (row.payload as Record<string, unknown>) ?? {},
      receivedAt: fromDbDate(row.received_at) as Date,
      result: row.result as SyncLogRow['result'],
      errorCode: (row.error_code as string | null) ?? null,
    };
  }

  async insertSyncLog(entry: Omit<SyncLogRow, 'id' | 'receivedAt'>, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`
      INSERT INTO ${this.syncLog}
        (id, organization_id, client_device_id, idempotency_key, payload, received_at, result, error_code)
      VALUES
        (${crypto.randomUUID()}, ${entry.organizationId}, ${entry.clientDeviceId}, ${entry.idempotencyKey},
         ${JSON.stringify(entry.payload)}::jsonb, NOW(), ${entry.result}, ${entry.errorCode})
    `);
  }

  // ─── Composition helpers ────────────────────────────────────────────────

  private async composeSale(row: Record<string, unknown>, db: PostgresJsDatabase): Promise<SaleRow> {
    const saleId = row.id as string;
    const [lineRows, paymentRows] = await Promise.all([
      db.execute<Record<string, unknown>>(
        sql`SELECT * FROM ${this.saleLines} WHERE sale_id = ${saleId} ORDER BY created_at ASC, id ASC`,
      ),
      db.execute<Record<string, unknown>>(
        sql`SELECT * FROM ${this.payments} WHERE sale_id = ${saleId} ORDER BY captured_at ASC, id ASC`,
      ),
    ]);
    return {
      ...this.rowToSale(row),
      lines: lineRows.map((line) => this.rowToSaleLine(line)),
      payments: paymentRows.map((payment) => this.rowToPayment(payment)),
    };
  }

  private async composeRefund(row: Record<string, unknown>, db: PostgresJsDatabase): Promise<RefundRow> {
    const refundId = row.id as string;
    const lineRows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.refundLines} WHERE refund_id = ${refundId} ORDER BY created_at ASC, id ASC`,
    );
    return {
      ...this.rowToRefund(row),
      lines: lineRows.map((line) => this.rowToRefundLine(line)),
    };
  }

  // ─── Row mappers ────────────────────────────────────────────────────────

  /** numeric(18,4) comes back as '10.0000' — normalize to plain decimals. */
  private decimal(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number') return '0';
    const raw = String(value);
    if (!raw.includes('.')) return raw;
    return raw.replace(/\.?0+$/, '') || '0';
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

  private isUniqueViolation(err: unknown, constraint?: string): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as { code?: string; constraint?: string };
    if (e.code !== PG_UNIQUE_VIOLATION) return false;
    return constraint === undefined || e.constraint === constraint;
  }

  private rowToRegister(row: Record<string, unknown>): RegisterRow {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      name: row.name as string,
      code: row.code as string,
      warehouseId: row.warehouse_id as string,
      receiptPrefix: row.receipt_prefix as string,
      nextReceiptNumber: Number(row.next_receipt_number ?? 0),
      isActive: Boolean(row.is_active),
      openShiftId: (row.open_shift_id as string | null) ?? null,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      deletedAt: fromDbDate(row.deleted_at),
    };
  }

  private rowToShift(row: Record<string, unknown>): ShiftRow {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      registerId: row.register_id as string,
      openedBy: row.opened_by as string,
      openedAt: fromDbDate(row.opened_at) as Date,
      openingFloatAmountMinor: this.minor(row, 'opening_float_amount_minor'),
      closedBy: (row.closed_by as string | null) ?? null,
      closedAt: fromDbDate(row.closed_at),
      countedCashAmountMinor: this.nullableMinor(row, 'counted_cash_amount_minor'),
      expectedCashAmountMinor: this.nullableMinor(row, 'expected_cash_amount_minor'),
      varianceAmountMinor: this.nullableMinor(row, 'variance_amount_minor'),
      currency: row.currency as string,
      status: row.status as ShiftRow['status'],
      forcedClose: Boolean(row.forced_close),
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      createdBy: (row.created_by as string | null) ?? null,
      updatedBy: (row.updated_by as string | null) ?? null,
    };
  }

  private rowToSale(row: Record<string, unknown>): Omit<SaleRow, 'lines' | 'payments'> {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      shiftId: row.shift_id as string,
      registerId: row.register_id as string,
      receiptNumber: row.receipt_number as string,
      customerContactId: (row.customer_contact_id as string | null) ?? null,
      status: row.status as SaleRow['status'],
      subtotalAmountMinor: this.minor(row, 'subtotal_amount_minor'),
      discountAmountMinor: this.minor(row, 'discount_amount_minor'),
      taxAmountMinor: this.minor(row, 'tax_amount_minor'),
      totalAmountMinor: this.minor(row, 'total_amount_minor'),
      currency: row.currency as string,
      exchangeRate: this.nullableMinor(row, 'exchange_rate'),
      baseTotalAmountMinor: this.nullableMinor(row, 'base_total_amount_minor'),
      locale: row.locale as string,
      idempotencyKey: (row.idempotency_key as string | null) ?? null,
      soldAt: fromDbDate(row.sold_at) as Date,
      syncedAt: fromDbDate(row.synced_at),
      clientDeviceId: (row.client_device_id as string | null) ?? null,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      createdBy: (row.created_by as string | null) ?? null,
      updatedBy: (row.updated_by as string | null) ?? null,
    };
  }

  private rowToSaleLine(row: Record<string, unknown>): SaleLineRow {
    return {
      id: row.id as string,
      saleId: row.sale_id as string,
      variantId: row.variant_id as string,
      skuSnapshot: row.sku_snapshot as string,
      nameSnapshot: (row.name_snapshot as Record<string, string>) ?? {},
      quantity: this.decimal(row.quantity),
      unitPriceAmountMinor: this.minor(row, 'unit_price_amount_minor'),
      lineDiscountAmountMinor: this.minor(row, 'line_discount_amount_minor'),
      taxRateBp: Number(row.tax_rate_bp ?? 0),
      taxAmountMinor: this.minor(row, 'tax_amount_minor'),
      lineTotalAmountMinor: this.minor(row, 'line_total_amount_minor'),
      currency: row.currency as string,
    };
  }

  private rowToPayment(row: Record<string, unknown>): PaymentRow {
    return {
      id: row.id as string,
      saleId: row.sale_id as string,
      method: row.method as PaymentRow['method'],
      amountMinor: this.minor(row, 'amount_minor'),
      currency: row.currency as string,
      tenderedAmountMinor: this.nullableMinor(row, 'tendered_amount_minor'),
      changeAmountMinor: this.minor(row, 'change_amount_minor'),
      reference: (row.reference as string | null) ?? null,
      capturedAt: fromDbDate(row.captured_at) as Date,
      createdBy: (row.created_by as string | null) ?? null,
    };
  }

  private rowToRefund(row: Record<string, unknown>): Omit<RefundRow, 'lines'> {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      originalSaleId: row.original_sale_id as string,
      shiftId: row.shift_id as string,
      registerId: row.register_id as string,
      reasonCode: row.reason_code as string,
      amountMinor: this.minor(row, 'amount_minor'),
      currency: row.currency as string,
      refundedAt: fromDbDate(row.refunded_at) as Date,
      createdAt: fromDbDate(row.created_at) as Date,
      createdBy: (row.created_by as string | null) ?? null,
    };
  }

  private rowToRefundLine(row: Record<string, unknown>): RefundLineRow {
    return {
      id: row.id as string,
      refundId: row.refund_id as string,
      saleLineId: row.sale_line_id as string,
      variantId: row.variant_id as string,
      quantity: this.decimal(row.quantity),
      restock: Boolean(row.restock),
      amountMinor: this.minor(row, 'amount_minor'),
      currency: row.currency as string,
    };
  }
}

/** Group rows by a key, mapping each to a typed value (batch child reads). */
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
