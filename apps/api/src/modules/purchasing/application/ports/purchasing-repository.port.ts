import type { TxOrDb } from '../../../../core/database/repository.base.js';
import type {
  BillData,
  GrnData,
  PurchaseOrderData,
  RequisitionData,
  SupplierData,
  SupplierReturnData,
  VendorLedgerEntryData,
} from '../../domain/index.js';

/** DI token for the purchasing repository. */
export const PURCHASING_REPOSITORY = Symbol('PURCHASING_REPOSITORY');

/** A paginated result page (shared shape with the other modules). */
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** One supplier row in the list (with its derived vendor balance, PUR-2). */
export interface SupplierRow extends SupplierData {
  /** Signed sum of the vendor-ledger entries (PUR-2) — always derived. */
  balanceMinor: string;
}

/** One PO row with its lines + supplier name snapshot. */
export interface PurchaseOrderRow extends PurchaseOrderData {
  supplierNameSnapshot: string;
}

/** One GRN row with its lines + supplier/PO number snapshots. */
export interface GrnRow extends GrnData {
  poNumber: string;
  supplierNameSnapshot: string;
}

/** One bill row with its lines + supplier snapshot. */
export interface BillRow extends BillData {
  supplierNameSnapshot: string;
}

/** One payment row. */
export interface SupplierPaymentRow {
  id: string;
  organizationId: string;
  number: string;
  supplierId: string;
  supplierNameSnapshot: string;
  method: string;
  amountMinor: string;
  currency: string;
  paidAt: string;
  reference: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  createdBy: string | null;
}

/** One payment with its allocations across bills. */
export interface SupplierPaymentDetailRow extends SupplierPaymentRow {
  allocations: Array<{
    id: string;
    billId: string;
    billNumber: string;
    amountMinor: string;
    currency: string;
  }>;
}

/** One supplier-return row with its lines. */
export interface SupplierReturnRow extends SupplierReturnData {
  supplierNameSnapshot: string;
  billNumber: string | null;
}

/** One vendor-ledger entry row. */
export interface VendorLedgerRow extends VendorLedgerEntryData {
  referenceNumber: string | null;
}

/** Filters for the paginated PO listing. */
export interface PurchaseOrderFilter {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

/** Filters for the paginated bill listing. */
export interface BillFilter {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

/** Filters for the paginated GRN listing. */
export interface GrnFilter {
  q?: string;
  page?: number;
  pageSize?: number;
}

/** Filters for the paginated payment listing. */
export interface PaymentFilter {
  q?: string;
  method?: string;
  page?: number;
  pageSize?: number;
}

/** Filters for the paginated return listing. */
export interface SupplierReturnFilter {
  q?: string;
  page?: number;
  pageSize?: number;
}

/**
 * The purchasing read/write repository. RLS scopes every query to the org.
 *
 * @see ARCHITECTURE.md §6 — the repository is a port declared in the
 *      application layer, implemented by Drizzle in infrastructure; the
 *      domain never imports it
 */
export interface PurchasingRepository {
  // ─── Suppliers (PUR-1) ─────────────────────────────────────────────────
  /** PUR-1: allocate the next gap-free supplier code (SUP-xxxxx). */
  allocateSupplierCode(tx?: TxOrDb): Promise<string>;
  listSuppliers(
    filter?: { q?: string; page?: number; pageSize?: number },
    tx?: TxOrDb,
  ): Promise<PageResult<SupplierRow>>;
  listAllSuppliers(tx?: TxOrDb): Promise<SupplierRow[]>;
  findSupplierById(id: string, tx?: TxOrDb): Promise<SupplierRow | undefined>;
  findSupplierByCode(code: string, tx?: TxOrDb): Promise<SupplierData | undefined>;
  /** PUR-1: tax id unique per org (null tax id → never matches). */
  findSupplierByTaxId(taxId: string, tx?: TxOrDb): Promise<SupplierData | undefined>;
  insertSupplier(supplier: SupplierData, tx?: TxOrDb): Promise<void>;
  updateSupplier(id: string, patch: Partial<SupplierData>, tx?: TxOrDb): Promise<void>;

  // ─── Vendor ledger (PUR-2) ─────────────────────────────────────────────
  insertLedgerEntry(entry: VendorLedgerEntryData, tx?: TxOrDb): Promise<void>;
  /** PUR-13: a replayed operation with the same key is a no-op. */
  findLedgerEntryByIdempotencyKey(idempotencyKey: string, tx?: TxOrDb): Promise<VendorLedgerEntryData | undefined>;
  /** PUR-2: a supplier's balance = signed sum of its entries. */
  sumSupplierBalance(supplierId: string, tx?: TxOrDb): Promise<string>;
  listLedgerEntries(supplierId: string, tx?: TxOrDb): Promise<VendorLedgerRow[]>;

  // ─── Requisitions (PUR-12) ─────────────────────────────────────────────
  allocateRequisitionNumber(tx?: TxOrDb): Promise<string>;
  insertRequisition(requisition: RequisitionData, tx?: TxOrDb): Promise<void>;
  findRequisitionById(id: string, tx?: TxOrDb): Promise<RequisitionData | undefined>;
  updateRequisitionStatus(id: string, status: string, tx?: TxOrDb): Promise<void>;

  // ─── Purchase orders (PUR-3, PUR-8) ────────────────────────────────────
  allocatePoNumber(tx?: TxOrDb): Promise<string>;
  insertPurchaseOrder(po: PurchaseOrderData, tx?: TxOrDb): Promise<void>;
  findPurchaseOrderById(id: string, tx?: TxOrDb): Promise<PurchaseOrderRow | undefined>;
  updatePurchaseOrderStatus(id: string, status: string, tx?: TxOrDb): Promise<void>;
  /** PUR-4: bump a PO line's received_quantity (called under the GRN tx). */
  updatePoLineReceived(poLineId: string, receivedQuantity: string, tx?: TxOrDb): Promise<void>;
  /** PUR-4: the PO line rows for a PO (for receiving + three-way match). */
  listPoLines(
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
  >;
  listPurchaseOrders(filter: PurchaseOrderFilter, tx?: TxOrDb): Promise<PageResult<PurchaseOrderRow>>;

  // ─── GRNs (PUR-4, PUR-5) ───────────────────────────────────────────────
  allocateGrnNumber(tx?: TxOrDb): Promise<string>;
  insertGrn(grn: GrnData, tx?: TxOrDb): Promise<void>;
  findGrnById(id: string, tx?: TxOrDb): Promise<GrnRow | undefined>;
  /** PUR-9: the GRN line's snapshot cost for the bill cost-variance check. */
  findGrnLineById(
    id: string,
    tx?: TxOrDb,
  ): Promise<
    | { id: string; variantId: string | null; quantity: string; unitCostMinor: string; unitCostCurrency: string }
    | undefined
  >;
  updateGrnStatus(id: string, status: string, receivedAt: Date, receivedBy: string | null, tx?: TxOrDb): Promise<void>;
  listGrns(filter: GrnFilter, tx?: TxOrDb): Promise<PageResult<GrnRow>>;

  // ─── Bills (PUR-6, PUR-7, PUR-9) ───────────────────────────────────────
  allocateBillNumber(tx?: TxOrDb): Promise<string>;
  insertBill(bill: BillData, tx?: TxOrDb): Promise<void>;
  findBillById(id: string, tx?: TxOrDb): Promise<BillRow | undefined>;
  updateBillStatus(id: string, status: string, tx?: TxOrDb): Promise<void>;
  updateBillPaidAmount(id: string, paidMinor: string, tx?: TxOrDb): Promise<void>;
  listBills(filter: BillFilter, tx?: TxOrDb): Promise<PageResult<BillRow>>;
  /** PUR-7: Σ allocations per bill. */
  sumAllocationsByBill(billId: string, tx?: TxOrDb): Promise<string>;

  // ─── Supplier payments (PUR-7) ─────────────────────────────────────────
  allocatePaymentNumber(tx?: TxOrDb): Promise<string>;
  insertPayment(
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
  ): Promise<void>;
  insertPaymentAllocation(
    data: {
      id: string;
      organizationId: string;
      paymentId: string;
      billId: string;
      amountMinor: string;
      currency: string;
    },
    tx?: TxOrDb,
  ): Promise<void>;
  listPayments(filter: PaymentFilter, tx?: TxOrDb): Promise<PageResult<SupplierPaymentRow>>;
  getPaymentDetail(id: string, tx?: TxOrDb): Promise<SupplierPaymentDetailRow | undefined>;

  // ─── Supplier returns (PUR-11) ─────────────────────────────────────────
  allocateReturnNumber(tx?: TxOrDb): Promise<string>;
  insertSupplierReturn(supplierReturn: SupplierReturnData, tx?: TxOrDb): Promise<void>;
  findSupplierReturnById(id: string, tx?: TxOrDb): Promise<SupplierReturnRow | undefined>;
  updateSupplierReturnStatus(id: string, status: string, returnedAt: Date, tx?: TxOrDb): Promise<void>;
  listSupplierReturns(filter: SupplierReturnFilter, tx?: TxOrDb): Promise<PageResult<SupplierReturnRow>>;

  // ─── Settings + counters ───────────────────────────────────────────────
  /** PUR-12: the org's purchasing settings (approval_required + counters). */
  ensureOrgSettings(tx?: TxOrDb): Promise<void>;
  getOrgSettings(tx?: TxOrDb): Promise<{ approvalRequired: boolean; features: string[] } | undefined>;
}
