import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';

/** ISO string of a DB timestamp; a missing/parsing-failed value → epoch. */
function isoOf(value: unknown): string {
  return fromDbDate(value)?.toISOString() ?? new Date(0).toISOString();
}

/** ISO date (YYYY-MM-DD) of a DB date column; missing → epoch date. */
function dateOf(value: unknown): string {
  return isoOf(value).slice(0, 10);
}
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { TenantContext } from '../../../../core/tenancy/tenant-context.js';
import type {
  BillFilter,
  BillRow,
  GrnFilter,
  GrnRow,
  PageResult,
  PaymentFilter,
  PurchaseOrderFilter,
  PurchaseOrderRow,
  PurchasingRepository,
  SupplierPaymentDetailRow,
  SupplierPaymentRow,
  SupplierReturnFilter,
  SupplierReturnRow,
  SupplierRow,
  VendorLedgerRow,
} from '../../application/ports/index.js';
import type {
  BillData,
  GrnData,
  PurchaseOrderData,
  RequisitionData,
  SupplierData,
  SupplierReturnData,
  VendorLedgerEntryData,
} from '../../domain/index.js';

/**
 * Actor uuid for audit columns. System-driven paths (event handlers, jobs)
 * run with a non-UUID `system` sentinel — only a real user UUID is persisted.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function sanitizeActorId(value: string | null | undefined): string | null {
  return value !== undefined && value !== null && UUID_RE.test(value) ? value : null;
}

/**
 * DrizzlePurchasingRepository — Drizzle implementation of PurchasingRepository.
 *
 * RLS scopes every query to the current organization (fail-closed), so no
 * manual organization_id filters are used (hard rule #2). Inserts populate
 * organization_id from TenantContext, never from client input.
 *
 * Ledger discipline (hard rule #8): pur_vendor_ledger is append-only (PUR-2) —
 * this repository only ever INSERTs ledger rows, never UPDATEs or DELETEs
 * (the DB trigger rejects it anyway).
 */
@Injectable()
export class DrizzlePurchasingRepository implements PurchasingRepository {
  private readonly suppliers = sql.identifier('pur_suppliers');
  private readonly vendorLedger = sql.identifier('pur_vendor_ledger');
  private readonly requisitions = sql.identifier('pur_requisitions');
  private readonly requisitionLines = sql.identifier('pur_requisition_lines');
  private readonly purchaseOrders = sql.identifier('pur_purchase_orders');
  private readonly poLines = sql.identifier('pur_po_lines');
  private readonly grns = sql.identifier('pur_grns');
  private readonly grnLines = sql.identifier('pur_grn_lines');
  private readonly bills = sql.identifier('pur_bills');
  private readonly billLines = sql.identifier('pur_bill_lines');
  private readonly payments = sql.identifier('pur_supplier_payments');
  private readonly paymentAllocations = sql.identifier('pur_payment_allocations');
  private readonly supplierReturns = sql.identifier('pur_supplier_returns');
  private readonly supplierReturnLines = sql.identifier('pur_supplier_return_lines');
  private readonly orgSettings = sql.identifier('pur_org_settings');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  // ─── Suppliers (PUR-1) ─────────────────────────────────────────────────

  async allocateSupplierCode(tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    await this.ensureOrgSettings(db);
    const rows = await db.execute<Record<string, unknown>>(sql`
      UPDATE ${this.orgSettings}
      SET next_supplier_code = next_supplier_code + 1
      WHERE organization_id = ${organizationId}
      RETURNING next_supplier_code AS n
    `);
    const row = rows[0];
    if (!row) throw new Error('allocateSupplierCode: org settings row missing');
    return `SUP-${String(Number(row.n)).padStart(5, '0')}`;
  }

  async listSuppliers(
    filter: { q?: string; page?: number; pageSize?: number } = {},
    tx?: TxOrDb,
  ): Promise<PageResult<SupplierRow>> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const q = filter.q?.trim();

    const where = q ? sql`WHERE (name ILIKE ${`%${q}%`} OR code ILIKE ${`%${q}%`} OR tax_id ILIKE ${`%${q}%`})` : sql``;
    const countRows = await db.execute<{ c: number }>(sql`
      SELECT COUNT(*)::int AS c FROM ${this.suppliers} ${where}
    `);
    const total = countRows[0]?.c ?? 0;

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT s.*, COALESCE(l.balance, 0)::bigint AS balance_minor
      FROM ${this.suppliers} s
      LEFT JOIN (
        SELECT supplier_id, SUM(amount_minor)::bigint AS balance
        FROM ${this.vendorLedger}
        GROUP BY supplier_id
      ) l ON l.supplier_id = s.id
      ${where}
      ORDER BY s.name ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `);

    return {
      items: rows.map((row) => this.mapSupplierRow(row)),
      total,
      page,
      pageSize,
    };
  }

  async listAllSuppliers(tx?: TxOrDb): Promise<SupplierRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT s.*, COALESCE(l.balance, 0)::bigint AS balance_minor
      FROM ${this.suppliers} s
      LEFT JOIN (
        SELECT supplier_id, SUM(amount_minor)::bigint AS balance
        FROM ${this.vendorLedger}
        GROUP BY supplier_id
      ) l ON l.supplier_id = s.id
      WHERE s.deleted_at IS NULL
      ORDER BY s.name ASC
    `);
    return rows.map((row) => this.mapSupplierRow(row));
  }

  async findSupplierById(id: string, tx?: TxOrDb): Promise<SupplierRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT s.*, COALESCE(l.balance, 0)::bigint AS balance_minor
      FROM ${this.suppliers} s
      LEFT JOIN (
        SELECT supplier_id, SUM(amount_minor)::bigint AS balance
        FROM ${this.vendorLedger}
        GROUP BY supplier_id
      ) l ON l.supplier_id = s.id
      WHERE s.id = ${id} AND s.deleted_at IS NULL
      LIMIT 1
    `);
    const row = rows[0];
    return row ? this.mapSupplierRow(row) : undefined;
  }

  async findSupplierByCode(code: string, tx?: TxOrDb): Promise<SupplierData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.suppliers} WHERE code = ${code} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    return row ? this.mapSupplier(row) : undefined;
  }

  async findSupplierByTaxId(taxId: string, tx?: TxOrDb): Promise<SupplierData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.suppliers} WHERE tax_id = ${taxId} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    return row ? this.mapSupplier(row) : undefined;
  }

  async insertSupplier(supplier: SupplierData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.suppliers}
        (id, organization_id, code, name, tax_id, payment_terms, currency,
         contact_name, contact_email, contact_phone, address, bank_account, is_active,
         created_at, updated_at, created_by, updated_by)
      VALUES
        (${supplier.id}, ${supplier.organizationId}, ${supplier.code}, ${supplier.name}, ${supplier.taxId},
         ${JSON.stringify(supplier.paymentTerms)}::jsonb, ${supplier.currency},
         ${supplier.contactName}, ${supplier.contactEmail}, ${supplier.contactPhone},
         ${supplier.address ? JSON.stringify(supplier.address) : null}::jsonb,
         ${supplier.bankAccount ? JSON.stringify(supplier.bankAccount) : null}::jsonb,
         ${supplier.isActive},
         ${toDbDate(new Date(supplier.createdAt))}, ${toDbDate(new Date(supplier.updatedAt))}, ${userId}, ${userId})
    `);
  }

  async updateSupplier(id: string, patch: Partial<SupplierData>, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      UPDATE ${this.suppliers}
      SET name = ${patch.name ?? sql`name`},
          tax_id = ${patch.taxId !== undefined ? patch.taxId : sql`tax_id`},
          payment_terms = ${patch.paymentTerms ? JSON.stringify(patch.paymentTerms) + '::jsonb' : sql`payment_terms`},
          currency = ${patch.currency ?? sql`currency`},
          contact_name = ${patch.contactName !== undefined ? patch.contactName : sql`contact_name`},
          contact_email = ${patch.contactEmail !== undefined ? patch.contactEmail : sql`contact_email`},
          contact_phone = ${patch.contactPhone !== undefined ? patch.contactPhone : sql`contact_phone`},
          address = ${patch.address !== undefined ? (patch.address ? JSON.stringify(patch.address) + '::jsonb' : null) : sql`address`},
          bank_account = ${patch.bankAccount !== undefined ? (patch.bankAccount ? JSON.stringify(patch.bankAccount) + '::jsonb' : null) : sql`bank_account`},
          is_active = ${patch.isActive !== undefined ? patch.isActive : sql`is_active`},
          updated_at = NOW(),
          updated_by = ${userId}
      WHERE id = ${id}
    `);
  }

  // ─── Vendor ledger (PUR-2) ─────────────────────────────────────────────

  async insertLedgerEntry(entry: VendorLedgerEntryData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.vendorLedger}
        (id, organization_id, supplier_id, type, amount_minor, currency,
         reference_type, reference_id, entry_date, idempotency_key, created_at, created_by)
      VALUES
        (${entry.id}, ${entry.organizationId}, ${entry.supplierId}, ${entry.type}, ${entry.amountMinor},
         ${entry.currency}, ${entry.referenceType}, ${entry.referenceId}, ${entry.entryDate},
         ${entry.idempotencyKey}, ${toDbDate(new Date(entry.createdAt))}, ${userId})
    `);
  }

  async findLedgerEntryByIdempotencyKey(
    idempotencyKey: string,
    tx?: TxOrDb,
  ): Promise<VendorLedgerEntryData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.vendorLedger} WHERE idempotency_key = ${idempotencyKey} LIMIT 1
    `);
    const row = rows[0];
    return row ? this.mapLedgerEntry(row) : undefined;
  }

  async sumSupplierBalance(supplierId: string, tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const rows = await db.execute<{ balance: number | null }>(sql`
      SELECT SUM(amount_minor)::bigint AS balance
      FROM ${this.vendorLedger}
      WHERE supplier_id = ${supplierId}
    `);
    return (rows[0]?.balance ?? 0).toString();
  }

  async listLedgerEntries(supplierId: string, tx?: TxOrDb): Promise<VendorLedgerRow[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT l.*,
        CASE l.reference_type
          WHEN 'bill' THEN b.number
          WHEN 'payment' THEN p.number
          WHEN 'supplier_return' THEN r.number
          ELSE NULL
        END AS reference_number
      FROM ${this.vendorLedger} l
      LEFT JOIN ${this.bills} b ON b.id = l.reference_id AND l.reference_type = 'bill'
      LEFT JOIN ${this.payments} p ON p.id = l.reference_id AND l.reference_type = 'payment'
      LEFT JOIN ${this.supplierReturns} r ON r.id = l.reference_id AND l.reference_type = 'supplier_return'
      WHERE l.supplier_id = ${supplierId}
      ORDER BY l.entry_date ASC, l.created_at ASC
    `);
    return rows.map((row) => ({
      ...this.mapLedgerEntry(row),
      referenceNumber: (row.reference_number as string | null) ?? null,
    }));
  }

  // ─── Requisitions (PUR-12) ─────────────────────────────────────────────

  async allocateRequisitionNumber(tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    await this.ensureOrgSettings(db);
    const rows = await db.execute<Record<string, unknown>>(sql`
      UPDATE ${this.orgSettings}
      SET next_requisition_number = next_requisition_number + 1
      WHERE organization_id = ${organizationId}
      RETURNING next_requisition_number AS n
    `);
    const row = rows[0];
    if (!row) throw new Error('allocateRequisitionNumber: org settings row missing');
    return `REQ-${String(Number(row.n)).padStart(5, '0')}`;
  }

  async insertRequisition(requisition: RequisitionData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.requisitions}
        (id, organization_id, number, status, requested_by, required_by_date, notes,
         approval_chain, created_at, updated_at, created_by, updated_by)
      VALUES
        (${requisition.id}, ${requisition.organizationId}, ${requisition.number}, ${requisition.status},
         ${requisition.requestedBy}, ${requisition.requiredByDate}, ${requisition.notes},
         ${requisition.approvalChain ? JSON.stringify(requisition.approvalChain) : null}::jsonb,
         ${toDbDate(new Date(requisition.createdAt))}, ${toDbDate(new Date(requisition.updatedAt))}, ${userId}, ${userId})
    `);
    for (const line of requisition.lines) {
      await db.execute(sql`
        INSERT INTO ${this.requisitionLines}
          (id, organization_id, requisition_id, variant_id, item_name_snapshot, quantity,
           estimated_unit_cost_minor, estimated_unit_cost_currency, created_at, created_by)
        VALUES
          (${line.id}, ${requisition.organizationId}, ${requisition.id}, ${line.variantId},
           ${line.itemNameSnapshot}, ${line.quantity}, ${line.estimatedUnitCostMinor},
           ${line.estimatedUnitCostCurrency}, ${toDbDate(new Date(requisition.createdAt))}, ${userId})
      `);
    }
  }

  async findRequisitionById(id: string, tx?: TxOrDb): Promise<RequisitionData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.requisitions} WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.composeRequisition(row, db);
  }

  async updateRequisitionStatus(id: string, status: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`
      UPDATE ${this.requisitions} SET status = ${status}, updated_at = NOW() WHERE id = ${id}
    `);
  }

  // ─── Purchase orders (PUR-3, PUR-8) ────────────────────────────────────

  async allocatePoNumber(tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    await this.ensureOrgSettings(db);
    const rows = await db.execute<Record<string, unknown>>(sql`
      UPDATE ${this.orgSettings}
      SET next_po_number = next_po_number + 1
      WHERE organization_id = ${organizationId}
      RETURNING next_po_number AS n
    `);
    const row = rows[0];
    if (!row) throw new Error('allocatePoNumber: org settings row missing');
    return `PO-${String(Number(row.n)).padStart(5, '0')}`;
  }

  async insertPurchaseOrder(po: PurchaseOrderData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.purchaseOrders}
        (id, organization_id, number, supplier_id, status, order_date, expected_date,
         currency, subtotal_minor, discount_minor, tax_minor, total_minor, notes,
         created_at, updated_at, created_by, updated_by)
      VALUES
        (${po.id}, ${po.organizationId}, ${po.number}, ${po.supplierId}, ${po.status},
         ${po.orderDate}, ${po.expectedDate}, ${po.currency}, ${po.subtotalMinor},
         ${po.discountMinor}, ${po.taxMinor}, ${po.totalMinor}, ${po.notes},
         ${toDbDate(new Date(po.createdAt))}, ${toDbDate(new Date(po.updatedAt))}, ${userId}, ${userId})
    `);
    for (const line of po.lines) {
      await db.execute(sql`
        INSERT INTO ${this.poLines}
          (id, organization_id, po_id, variant_id, item_name_snapshot, quantity,
           received_quantity, unit_cost_minor, unit_cost_currency, discount_minor,
           tax_rate_bp_snapshot, line_total_minor, created_at, created_by)
        VALUES
          (${line.id}, ${po.organizationId}, ${po.id}, ${line.variantId}, ${line.itemNameSnapshot},
           ${line.quantity}, ${line.receivedQuantity}, ${line.unitCostMinor}, ${line.unitCostCurrency},
           ${line.discountMinor}, ${line.taxRateBpSnapshot}, ${line.lineTotalMinor},
           ${toDbDate(new Date(po.createdAt))}, ${userId})
      `);
    }
  }

  async findPurchaseOrderById(id: string, tx?: TxOrDb): Promise<PurchaseOrderRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT po.*, s.name AS supplier_name_snapshot
      FROM ${this.purchaseOrders} po
      JOIN ${this.suppliers} s ON s.id = po.supplier_id
      WHERE po.id = ${id} AND po.deleted_at IS NULL
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    return this.composePurchaseOrder(row, db);
  }

  async updatePurchaseOrderStatus(id: string, status: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`
      UPDATE ${this.purchaseOrders} SET status = ${status}, updated_at = NOW() WHERE id = ${id}
    `);
  }

  async updatePoLineReceived(poLineId: string, receivedQuantity: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`
      UPDATE ${this.poLines} SET received_quantity = ${receivedQuantity} WHERE id = ${poLineId}
    `);
  }

  async listPoLines(
    poId: string,
    tx?: TxOrDb,
  ): Promise<
    Array<{
      id: string;
      variantId: string | null;
      quantity: string;
      receivedQuantity: string;
      unitCostMinor: string;
      unitCostCurrency: string;
    }>
  > {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id, variant_id, quantity, received_quantity, unit_cost_minor, unit_cost_currency
      FROM ${this.poLines} WHERE po_id = ${poId}
    `);
    return rows.map((row) => ({
      id: row.id as string,
      variantId: (row.variant_id as string | null) ?? null,
      quantity: (row.quantity as string) ?? '0',
      receivedQuantity: (row.received_quantity as string) ?? '0',
      unitCostMinor: (row.unit_cost_minor as string) ?? '0',
      unitCostCurrency: (row.unit_cost_currency as string) ?? 'USD',
    }));
  }

  async listPurchaseOrders(filter: PurchaseOrderFilter = {}, tx?: TxOrDb): Promise<PageResult<PurchaseOrderRow>> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const q = filter.q?.trim();
    const conditions: string[] = [];
    if (q) conditions.push(`(po.number ILIKE '%${q}%' OR s.name ILIKE '%${q}%')`);
    if (filter.status) conditions.push(`po.status = '${filter.status}'`);
    const where = conditions.length ? sql`WHERE ${sql.raw(conditions.join(' AND '))}` : sql``;

    const countRows = await db.execute<{ c: number }>(sql`
      SELECT COUNT(*)::int AS c
      FROM ${this.purchaseOrders} po JOIN ${this.suppliers} s ON s.id = po.supplier_id
      ${where}
    `);
    const total = countRows[0]?.c ?? 0;

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT po.*, s.name AS supplier_name_snapshot
      FROM ${this.purchaseOrders} po
      JOIN ${this.suppliers} s ON s.id = po.supplier_id
      ${where}
      ORDER BY po.order_date DESC, po.created_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `);

    return {
      items: await Promise.all(rows.map((row) => this.composePurchaseOrder(row, db))),
      total,
      page,
      pageSize,
    };
  }

  // ─── GRNs (PUR-4, PUR-5) ───────────────────────────────────────────────

  async allocateGrnNumber(tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    await this.ensureOrgSettings(db);
    const rows = await db.execute<Record<string, unknown>>(sql`
      UPDATE ${this.orgSettings}
      SET next_grn_number = next_grn_number + 1
      WHERE organization_id = ${organizationId}
      RETURNING next_grn_number AS n
    `);
    const row = rows[0];
    if (!row) throw new Error('allocateGrnNumber: org settings row missing');
    return `GRN-${String(Number(row.n)).padStart(5, '0')}`;
  }

  async insertGrn(grn: GrnData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.grns}
        (id, organization_id, number, po_id, supplier_id, warehouse_id, status,
         received_at, received_by, created_at, updated_at, created_by, updated_by)
      VALUES
        (${grn.id}, ${grn.organizationId}, ${grn.number}, ${grn.poId}, ${grn.supplierId},
         ${grn.warehouseId}, ${grn.status}, ${grn.receivedAt ? toDbDate(new Date(grn.receivedAt)) : null},
         ${grn.receivedBy}, ${toDbDate(new Date(grn.createdAt))}, ${toDbDate(new Date(grn.updatedAt))}, ${userId}, ${userId})
    `);
    for (const line of grn.lines) {
      await db.execute(sql`
        INSERT INTO ${this.grnLines}
          (id, organization_id, grn_id, po_line_id, variant_id, quantity,
           unit_cost_minor, unit_cost_currency, accepted, created_at, created_by)
        VALUES
          (${line.id}, ${grn.organizationId}, ${grn.id}, ${line.poLineId}, ${line.variantId},
           ${line.quantity}, ${line.unitCostMinor}, ${line.unitCostCurrency}, ${line.accepted},
           ${toDbDate(new Date(grn.createdAt))}, ${userId})
      `);
    }
  }

  async findGrnById(id: string, tx?: TxOrDb): Promise<GrnRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT g.*, po.number AS po_number, s.name AS supplier_name_snapshot
      FROM ${this.grns} g
      JOIN ${this.purchaseOrders} po ON po.id = g.po_id
      JOIN ${this.suppliers} s ON s.id = g.supplier_id
      WHERE g.id = ${id}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    return this.composeGrn(row, db);
  }

  async findGrnLineById(
    id: string,
    tx?: TxOrDb,
  ): Promise<
    | { id: string; variantId: string | null; quantity: string; unitCostMinor: string; unitCostCurrency: string }
    | undefined
  > {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id, variant_id, quantity, unit_cost_minor, unit_cost_currency
      FROM ${this.grnLines} WHERE id = ${id} LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id as string,
      variantId: (row.variant_id as string | null) ?? null,
      quantity: (row.quantity as string) ?? '0',
      unitCostMinor: (row.unit_cost_minor as string) ?? '0',
      unitCostCurrency: (row.unit_cost_currency as string) ?? 'USD',
    };
  }

  async updateGrnStatus(
    id: string,
    status: string,
    receivedAt: Date,
    receivedBy: string | null,
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`
      UPDATE ${this.grns}
      SET status = ${status}, received_at = ${toDbDate(receivedAt)}, received_by = ${sanitizeActorId(receivedBy)}, updated_at = NOW()
      WHERE id = ${id}
    `);
  }

  async listGrns(filter: GrnFilter = {}, tx?: TxOrDb): Promise<PageResult<GrnRow>> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const q = filter.q?.trim();
    const where = q
      ? sql`WHERE (g.number ILIKE ${`%${q}%`} OR po.number ILIKE ${`%${q}%`} OR s.name ILIKE ${`%${q}%`})`
      : sql``;

    const countRows = await db.execute<{ c: number }>(sql`
      SELECT COUNT(*)::int AS c
      FROM ${this.grns} g
      JOIN ${this.purchaseOrders} po ON po.id = g.po_id
      JOIN ${this.suppliers} s ON s.id = g.supplier_id
      ${where}
    `);
    const total = countRows[0]?.c ?? 0;

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT g.*, po.number AS po_number, s.name AS supplier_name_snapshot
      FROM ${this.grns} g
      JOIN ${this.purchaseOrders} po ON po.id = g.po_id
      JOIN ${this.suppliers} s ON s.id = g.supplier_id
      ${where}
      ORDER BY g.created_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `);

    return {
      items: await Promise.all(rows.map((row) => this.composeGrn(row, db))),
      total,
      page,
      pageSize,
    };
  }

  // ─── Bills (PUR-6, PUR-7, PUR-9) ───────────────────────────────────────

  async allocateBillNumber(tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    await this.ensureOrgSettings(db);
    const rows = await db.execute<Record<string, unknown>>(sql`
      UPDATE ${this.orgSettings}
      SET next_bill_number = next_bill_number + 1
      WHERE organization_id = ${organizationId}
      RETURNING next_bill_number AS n
    `);
    const row = rows[0];
    if (!row) throw new Error('allocateBillNumber: org settings row missing');
    return `BILL-${String(Number(row.n)).padStart(5, '0')}`;
  }

  async insertBill(bill: BillData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.bills}
        (id, organization_id, number, supplier_id, po_id, grn_id, status, bill_date,
         due_date, currency, subtotal_minor, discount_minor, tax_minor, total_minor,
         supplier_tax_id_snapshot, idempotency_key, created_at, updated_at, created_by, updated_by)
      VALUES
        (${bill.id}, ${bill.organizationId}, ${bill.number}, ${bill.supplierId}, ${bill.poId}, ${bill.grnId},
         ${bill.status}, ${bill.billDate}, ${bill.dueDate}, ${bill.currency}, ${bill.subtotalMinor},
         ${bill.discountMinor}, ${bill.taxMinor}, ${bill.totalMinor}, ${bill.supplierTaxIdSnapshot},
         ${bill.idempotencyKey}, ${toDbDate(new Date(bill.createdAt))}, ${toDbDate(new Date(bill.updatedAt))}, ${userId}, ${userId})
    `);
    for (const line of bill.lines) {
      await db.execute(sql`
        INSERT INTO ${this.billLines}
          (id, organization_id, bill_id, po_line_id, grn_line_id, variant_id, item_name_snapshot, quantity,
           unit_cost_minor, unit_cost_currency, tax_rate_bp_snapshot, tax_minor, line_total_minor,
           created_at, created_by)
        VALUES
          (${line.id}, ${bill.organizationId}, ${bill.id}, ${line.poLineId}, ${line.grnLineId}, ${line.variantId},
           ${line.itemNameSnapshot}, ${line.quantity}, ${line.unitCostMinor}, ${line.unitCostCurrency}, ${line.taxRateBpSnapshot},
           ${line.taxMinor}, ${line.lineTotalMinor}, ${toDbDate(new Date(bill.createdAt))}, ${userId})
      `);
    }
  }

  async findBillById(id: string, tx?: TxOrDb): Promise<BillRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT b.*, s.name AS supplier_name_snapshot
      FROM ${this.bills} b
      JOIN ${this.suppliers} s ON s.id = b.supplier_id
      WHERE b.id = ${id} AND b.deleted_at IS NULL
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    return this.composeBill(row, db);
  }

  async updateBillStatus(id: string, status: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`
      UPDATE ${this.bills} SET status = ${status}, updated_at = NOW() WHERE id = ${id}
    `);
  }

  async updateBillPaidAmount(id: string, paidMinor: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`
      UPDATE ${this.bills} SET paid_minor = ${paidMinor}, updated_at = NOW() WHERE id = ${id}
    `);
  }

  async sumAllocationsByBill(billId: string, tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const rows = await db.execute<{ total: number | null }>(sql`
      SELECT SUM(amount_minor)::bigint AS total FROM ${this.paymentAllocations} WHERE bill_id = ${billId}
    `);
    return (rows[0]?.total ?? 0).toString();
  }

  async listBills(filter: BillFilter = {}, tx?: TxOrDb): Promise<PageResult<BillRow>> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const q = filter.q?.trim();
    const conditions: string[] = [];
    if (q) conditions.push(`(b.number ILIKE '%${q}%' OR s.name ILIKE '%${q}%')`);
    if (filter.status) conditions.push(`b.status = '${filter.status}'`);
    const where = conditions.length ? sql`WHERE ${sql.raw(conditions.join(' AND '))}` : sql``;

    const countRows = await db.execute<{ c: number }>(sql`
      SELECT COUNT(*)::int AS c
      FROM ${this.bills} b JOIN ${this.suppliers} s ON s.id = b.supplier_id
      ${where}
    `);
    const total = countRows[0]?.c ?? 0;

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT b.*, s.name AS supplier_name_snapshot
      FROM ${this.bills} b
      JOIN ${this.suppliers} s ON s.id = b.supplier_id
      ${where}
      ORDER BY b.bill_date DESC, b.created_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `);

    return {
      items: await Promise.all(rows.map((row) => this.composeBill(row, db))),
      total,
      page,
      pageSize,
    };
  }

  // ─── Supplier payments (PUR-7) ─────────────────────────────────────────

  async allocatePaymentNumber(tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    await this.ensureOrgSettings(db);
    const rows = await db.execute<Record<string, unknown>>(sql`
      UPDATE ${this.orgSettings}
      SET next_payment_number = next_payment_number + 1
      WHERE organization_id = ${organizationId}
      RETURNING next_payment_number AS n
    `);
    const row = rows[0];
    if (!row) throw new Error('allocatePaymentNumber: org settings row missing');
    return `PAY-${String(Number(row.n)).padStart(5, '0')}`;
  }

  async insertPayment(
    data: {
      id: string;
      organizationId: string;
      number: string;
      supplierId: string;
      method: string;
      amountMinor: string;
      currency: string;
      paidAt: Date;
      reference: string | null;
      idempotencyKey: string | null;
    },
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.payments}
        (id, organization_id, number, supplier_id, method, amount_minor, currency,
         paid_at, reference, idempotency_key, created_at, created_by)
      VALUES
        (${data.id}, ${data.organizationId}, ${data.number}, ${data.supplierId}, ${data.method},
         ${data.amountMinor}, ${data.currency}, ${toDbDate(data.paidAt)}, ${data.reference},
         ${data.idempotencyKey}, ${toDbDate(new Date())}, ${userId})
    `);
  }

  async insertPaymentAllocation(
    data: {
      id: string;
      organizationId: string;
      paymentId: string;
      billId: string;
      amountMinor: string;
      currency: string;
    },
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.paymentAllocations}
        (id, organization_id, payment_id, bill_id, amount_minor, currency, created_at, created_by)
      VALUES
        (${data.id}, ${data.organizationId}, ${data.paymentId}, ${data.billId}, ${data.amountMinor},
         ${data.currency}, ${toDbDate(new Date())}, ${userId})
    `);
  }

  async listPayments(filter: PaymentFilter = {}, tx?: TxOrDb): Promise<PageResult<SupplierPaymentRow>> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const q = filter.q?.trim();
    const conditions: string[] = [];
    if (q) conditions.push(`(p.number ILIKE '%${q}%' OR s.name ILIKE '%${q}%')`);
    if (filter.method) conditions.push(`p.method = '${filter.method}'`);
    const where = conditions.length ? sql`WHERE ${sql.raw(conditions.join(' AND '))}` : sql``;

    const countRows = await db.execute<{ c: number }>(sql`
      SELECT COUNT(*)::int AS c
      FROM ${this.payments} p JOIN ${this.suppliers} s ON s.id = p.supplier_id
      ${where}
    `);
    const total = countRows[0]?.c ?? 0;

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT p.*, s.name AS supplier_name_snapshot
      FROM ${this.payments} p
      JOIN ${this.suppliers} s ON s.id = p.supplier_id
      ${where}
      ORDER BY p.paid_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `);

    return {
      items: rows.map((row) => this.mapPaymentRow(row)),
      total,
      page,
      pageSize,
    };
  }

  async getPaymentDetail(id: string, tx?: TxOrDb): Promise<SupplierPaymentDetailRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT p.*, s.name AS supplier_name_snapshot
      FROM ${this.payments} p
      JOIN ${this.suppliers} s ON s.id = p.supplier_id
      WHERE p.id = ${id}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    const allocationRows = await db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.bill_id, a.amount_minor, a.currency, b.number AS bill_number
      FROM ${this.paymentAllocations} a
      JOIN ${this.bills} b ON b.id = a.bill_id
      WHERE a.payment_id = ${id}
    `);
    return {
      ...this.mapPaymentRow(row),
      allocations: allocationRows.map((a) => ({
        id: a.id as string,
        billId: a.bill_id as string,
        billNumber: a.bill_number as string,
        amountMinor: (a.amount_minor as string) ?? '0',
        currency: (a.currency as string) ?? 'USD',
      })),
    };
  }

  // ─── Supplier returns (PUR-11) ─────────────────────────────────────────

  async allocateReturnNumber(tx?: TxOrDb): Promise<string> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    await this.ensureOrgSettings(db);
    const rows = await db.execute<Record<string, unknown>>(sql`
      UPDATE ${this.orgSettings}
      SET next_return_number = next_return_number + 1
      WHERE organization_id = ${organizationId}
      RETURNING next_return_number AS n
    `);
    const row = rows[0];
    if (!row) throw new Error('allocateReturnNumber: org settings row missing');
    return `RET-${String(Number(row.n)).padStart(5, '0')}`;
  }

  async insertSupplierReturn(supplierReturn: SupplierReturnData, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const userId = sanitizeActorId(TenantContext.getUserId());
    await db.execute(sql`
      INSERT INTO ${this.supplierReturns}
        (id, organization_id, number, supplier_id, bill_id, grn_line_id, reason_code,
         status, amount_minor, currency, returned_at, created_at, updated_at, created_by, updated_by)
      VALUES
        (${supplierReturn.id}, ${supplierReturn.organizationId}, ${supplierReturn.number},
         ${supplierReturn.supplierId}, ${supplierReturn.billId}, ${supplierReturn.grnLineId},
         ${supplierReturn.reasonCode}, ${supplierReturn.status}, ${supplierReturn.amountMinor},
         ${supplierReturn.currency}, ${supplierReturn.returnedAt ? toDbDate(new Date(supplierReturn.returnedAt)) : null},
         ${toDbDate(new Date(supplierReturn.createdAt))}, ${toDbDate(new Date(supplierReturn.updatedAt))}, ${userId}, ${userId})
    `);
    for (const line of supplierReturn.lines) {
      await db.execute(sql`
        INSERT INTO ${this.supplierReturnLines}
          (id, organization_id, return_id, variant_id, quantity, unit_cost_minor,
           unit_cost_currency, created_at, created_by)
        VALUES
          (${line.id}, ${supplierReturn.organizationId}, ${supplierReturn.id}, ${line.variantId},
           ${line.quantity}, ${line.unitCostMinor}, ${line.unitCostCurrency},
           ${toDbDate(new Date(supplierReturn.createdAt))}, ${userId})
      `);
    }
  }

  async findSupplierReturnById(id: string, tx?: TxOrDb): Promise<SupplierReturnRow | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT r.*, s.name AS supplier_name_snapshot, b.number AS bill_number
      FROM ${this.supplierReturns} r
      JOIN ${this.suppliers} s ON s.id = r.supplier_id
      LEFT JOIN ${this.bills} b ON b.id = r.bill_id
      WHERE r.id = ${id}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    return this.composeSupplierReturn(row, db);
  }

  async updateSupplierReturnStatus(id: string, status: string, returnedAt: Date, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`
      UPDATE ${this.supplierReturns}
      SET status = ${status}, returned_at = ${toDbDate(returnedAt)}, updated_at = NOW()
      WHERE id = ${id}
    `);
  }

  async listSupplierReturns(filter: SupplierReturnFilter = {}, tx?: TxOrDb): Promise<PageResult<SupplierReturnRow>> {
    const db = this.getDb(tx);
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const q = filter.q?.trim();
    const where = q
      ? sql`WHERE (r.number ILIKE ${`%${q}%`} OR s.name ILIKE ${`%${q}%`} OR r.reason_code ILIKE ${`%${q}%`})`
      : sql``;

    const countRows = await db.execute<{ c: number }>(sql`
      SELECT COUNT(*)::int AS c
      FROM ${this.supplierReturns} r
      JOIN ${this.suppliers} s ON s.id = r.supplier_id
      ${where}
    `);
    const total = countRows[0]?.c ?? 0;

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT r.*, s.name AS supplier_name_snapshot, b.number AS bill_number
      FROM ${this.supplierReturns} r
      JOIN ${this.suppliers} s ON s.id = r.supplier_id
      LEFT JOIN ${this.bills} b ON b.id = r.bill_id
      ${where}
      ORDER BY r.created_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `);

    return {
      items: await Promise.all(rows.map((row) => this.composeSupplierReturn(row, db))),
      total,
      page,
      pageSize,
    };
  }

  // ─── Settings + counters ───────────────────────────────────────────────

  async ensureOrgSettings(tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    const organizationId = TenantContext.requireOrganizationId();
    await db.execute(sql`
      INSERT INTO ${this.orgSettings} (organization_id)
      VALUES (${organizationId})
      ON CONFLICT (organization_id) DO NOTHING
    `);
  }

  async getOrgSettings(tx?: TxOrDb): Promise<{ approvalRequired: boolean; features: string[] } | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT approval_required, features FROM ${this.orgSettings} LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    const rawFeatures = row.features;
    const features = Array.isArray(rawFeatures)
      ? rawFeatures
      : typeof rawFeatures === 'string'
        ? ((JSON.parse(rawFeatures) as string[]) ?? [])
        : [];
    return { approvalRequired: Boolean(row.approval_required), features };
  }

  // ─── row mapping helpers ───────────────────────────────────────────────

  private mapSupplier(row: Record<string, unknown>): SupplierData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      code: row.code as string,
      name: row.name as string,
      taxId: (row.tax_id as string | null) ?? null,
      paymentTerms: this.mapPaymentTerms(row.payment_terms),
      currency: (row.currency as string) ?? 'USD',
      contactName: (row.contact_name as string | null) ?? null,
      contactEmail: (row.contact_email as string | null) ?? null,
      contactPhone: (row.contact_phone as string | null) ?? null,
      address: (row.address as Record<string, unknown> | null) ?? null,
      bankAccount: (row.bank_account as Record<string, unknown> | null) ?? null,
      isActive: Boolean(row.is_active),
      createdAt: isoOf(row.created_at),
      updatedAt: isoOf(row.updated_at),
    };
  }

  private mapSupplierRow(row: Record<string, unknown>): SupplierRow {
    return {
      ...this.mapSupplier(row),
      balanceMinor: ((row.balance_minor as number) ?? 0).toString(),
    };
  }

  private mapPaymentTerms(value: unknown): { netDays: number; discountDays: number; discountRateBp: number } {
    if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      return {
        netDays: Number(v.net_days ?? v.netDays ?? 30),
        discountDays: Number(v.discount_days ?? v.discountDays ?? 0),
        discountRateBp: Number(v.discount_rate_bp ?? v.discountRateBp ?? 0),
      };
    }
    return { netDays: 30, discountDays: 0, discountRateBp: 0 };
  }

  private mapLedgerEntry(row: Record<string, unknown>): VendorLedgerEntryData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      supplierId: row.supplier_id as string,
      type: row.type as VendorLedgerEntryData['type'],
      amountMinor: ((row.amount_minor as number) ?? 0).toString(),
      currency: (row.currency as string) ?? 'USD',
      referenceType: row.reference_type as string,
      referenceId: (row.reference_id as string | null) ?? null,
      entryDate: dateOf(row.entry_date),
      idempotencyKey: (row.idempotency_key as string | null) ?? null,
      createdAt: isoOf(row.created_at),
      createdBy: (row.created_by as string | null) ?? null,
    };
  }

  private mapPaymentRow(row: Record<string, unknown>): SupplierPaymentRow {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      number: row.number as string,
      supplierId: row.supplier_id as string,
      supplierNameSnapshot: (row.supplier_name_snapshot as string) ?? '',
      method: row.method as string,
      amountMinor: ((row.amount_minor as number) ?? 0).toString(),
      currency: (row.currency as string) ?? 'USD',
      paidAt: isoOf(row.paid_at),
      reference: (row.reference as string | null) ?? null,
      idempotencyKey: (row.idempotency_key as string | null) ?? null,
      createdAt: isoOf(row.created_at),
      createdBy: (row.created_by as string | null) ?? null,
    };
  }

  private async composeRequisition(row: Record<string, unknown>, db: PostgresJsDatabase): Promise<RequisitionData> {
    const lines = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.requisitionLines} WHERE requisition_id = ${row.id} ORDER BY created_at ASC
    `);
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      number: row.number as string,
      status: row.status as RequisitionData['status'],
      requestedBy: (row.requested_by as string | null) ?? null,
      requiredByDate: (row.required_by_date as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      approvalChain: (row.approval_chain as RequisitionData['approvalChain']) ?? null,
      createdAt: isoOf(row.created_at),
      updatedAt: isoOf(row.updated_at),
      lines: lines.map((line) => ({
        id: line.id as string,
        organizationId: line.organization_id as string,
        requisitionId: line.requisition_id as string,
        variantId: (line.variant_id as string | null) ?? null,
        itemNameSnapshot: line.item_name_snapshot as string,
        quantity: (line.quantity as string) ?? '1',
        estimatedUnitCostMinor: ((line.estimated_unit_cost_minor as number) ?? 0).toString(),
        estimatedUnitCostCurrency: (line.estimated_unit_cost_currency as string) ?? 'USD',
      })),
    };
  }

  private async composePurchaseOrder(row: Record<string, unknown>, db: PostgresJsDatabase): Promise<PurchaseOrderRow> {
    const lines = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.poLines} WHERE po_id = ${row.id} ORDER BY created_at ASC
    `);
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      number: row.number as string,
      supplierId: row.supplier_id as string,
      status: row.status as PurchaseOrderData['status'],
      orderDate: dateOf(row.order_date),
      expectedDate: (row.expected_date as string | null) ?? null,
      currency: (row.currency as string) ?? 'USD',
      subtotalMinor: ((row.subtotal_minor as number) ?? 0).toString(),
      discountMinor: ((row.discount_minor as number) ?? 0).toString(),
      taxMinor: ((row.tax_minor as number) ?? 0).toString(),
      totalMinor: ((row.total_minor as number) ?? 0).toString(),
      notes: (row.notes as string | null) ?? null,
      createdAt: isoOf(row.created_at),
      updatedAt: isoOf(row.updated_at),
      supplierNameSnapshot: (row.supplier_name_snapshot as string) ?? '',
      lines: lines.map((line) => ({
        id: line.id as string,
        organizationId: line.organization_id as string,
        poId: line.po_id as string,
        variantId: (line.variant_id as string | null) ?? null,
        itemNameSnapshot: line.item_name_snapshot as string,
        quantity: (line.quantity as string) ?? '0',
        receivedQuantity: (line.received_quantity as string) ?? '0',
        unitCostMinor: ((line.unit_cost_minor as number) ?? 0).toString(),
        unitCostCurrency: (line.unit_cost_currency as string) ?? 'USD',
        discountMinor: ((line.discount_minor as number) ?? 0).toString(),
        taxRateBpSnapshot: Number(line.tax_rate_bp_snapshot ?? 0),
        lineTotalMinor: ((line.line_total_minor as number) ?? 0).toString(),
      })),
    };
  }

  private async composeGrn(row: Record<string, unknown>, db: PostgresJsDatabase): Promise<GrnRow> {
    const lines = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.grnLines} WHERE grn_id = ${row.id} ORDER BY created_at ASC
    `);
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      number: row.number as string,
      poId: row.po_id as string,
      supplierId: row.supplier_id as string,
      warehouseId: (row.warehouse_id as string | null) ?? null,
      status: row.status as GrnData['status'],
      receivedAt: row.received_at ? isoOf(row.received_at) : null,
      receivedBy: (row.received_by as string | null) ?? null,
      createdAt: isoOf(row.created_at),
      updatedAt: isoOf(row.updated_at),
      poNumber: (row.po_number as string) ?? '',
      supplierNameSnapshot: (row.supplier_name_snapshot as string) ?? '',
      lines: lines.map((line) => ({
        id: line.id as string,
        organizationId: line.organization_id as string,
        grnId: line.grn_id as string,
        poLineId: line.po_line_id as string,
        variantId: (line.variant_id as string | null) ?? null,
        quantity: (line.quantity as string) ?? '0',
        unitCostMinor: ((line.unit_cost_minor as number) ?? 0).toString(),
        unitCostCurrency: (line.unit_cost_currency as string) ?? 'USD',
        accepted: Boolean(line.accepted),
      })),
    };
  }

  private async composeBill(row: Record<string, unknown>, db: PostgresJsDatabase): Promise<BillRow> {
    const lines = await db.execute<Record<string, unknown>>(sql`
      SELECT bl.*, pl.item_name_snapshot
      FROM ${this.billLines} bl
      LEFT JOIN ${this.poLines} pl ON pl.id = bl.po_line_id
      WHERE bl.bill_id = ${row.id}
      ORDER BY bl.created_at ASC
    `);
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      number: row.number as string,
      supplierId: row.supplier_id as string,
      poId: (row.po_id as string | null) ?? null,
      grnId: (row.grn_id as string | null) ?? null,
      status: row.status as BillData['status'],
      billDate: dateOf(row.bill_date),
      dueDate: (row.due_date as string | null) ?? null,
      currency: (row.currency as string) ?? 'USD',
      subtotalMinor: ((row.subtotal_minor as number) ?? 0).toString(),
      discountMinor: ((row.discount_minor as number) ?? 0).toString(),
      taxMinor: ((row.tax_minor as number) ?? 0).toString(),
      totalMinor: ((row.total_minor as number) ?? 0).toString(),
      supplierTaxIdSnapshot: (row.supplier_tax_id_snapshot as string | null) ?? null,
      idempotencyKey: (row.idempotency_key as string | null) ?? null,
      paidMinor: ((row.paid_minor as number) ?? 0).toString(),
      createdAt: isoOf(row.created_at),
      updatedAt: isoOf(row.updated_at),
      supplierNameSnapshot: (row.supplier_name_snapshot as string) ?? '',
      lines: lines.map((line) => ({
        id: line.id as string,
        organizationId: line.organization_id as string,
        billId: line.bill_id as string,
        poLineId: (line.po_line_id as string | null) ?? null,
        grnLineId: (line.grn_line_id as string | null) ?? null,
        variantId: (line.variant_id as string | null) ?? null,
        itemNameSnapshot: (line.item_name_snapshot as string | null) ?? '',
        quantity: (line.quantity as string) ?? '0',
        unitCostMinor: ((line.unit_cost_minor as number) ?? 0).toString(),
        unitCostCurrency: (line.unit_cost_currency as string) ?? 'USD',
        taxRateBpSnapshot: Number(line.tax_rate_bp_snapshot ?? 0),
        taxMinor: ((line.tax_minor as number) ?? 0).toString(),
        lineTotalMinor: ((line.line_total_minor as number) ?? 0).toString(),
      })),
    };
  }

  private async composeSupplierReturn(
    row: Record<string, unknown>,
    db: PostgresJsDatabase,
  ): Promise<SupplierReturnRow> {
    const lines = await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM ${this.supplierReturnLines} WHERE return_id = ${row.id} ORDER BY created_at ASC
    `);
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      number: row.number as string,
      supplierId: row.supplier_id as string,
      billId: (row.bill_id as string | null) ?? null,
      grnLineId: (row.grn_line_id as string | null) ?? null,
      reasonCode: row.reason_code as string,
      status: row.status as SupplierReturnData['status'],
      amountMinor: ((row.amount_minor as number) ?? 0).toString(),
      currency: (row.currency as string) ?? 'USD',
      returnedAt: row.returned_at ? isoOf(row.returned_at) : null,
      createdAt: isoOf(row.created_at),
      updatedAt: isoOf(row.updated_at),
      supplierNameSnapshot: (row.supplier_name_snapshot as string) ?? '',
      billNumber: (row.bill_number as string | null) ?? null,
      lines: lines.map((line) => ({
        id: line.id as string,
        organizationId: line.organization_id as string,
        returnId: line.return_id as string,
        variantId: (line.variant_id as string | null) ?? null,
        quantity: (line.quantity as string) ?? '0',
        unitCostMinor: ((line.unit_cost_minor as number) ?? 0).toString(),
        unitCostCurrency: (line.unit_cost_currency as string) ?? 'USD',
      })),
    };
  }
}
