// Cross-module port infrastructure.
// Ports are the only way modules communicate synchronously (Level 2/3).
//
// Each port is declared here as an interface + DI token symbol.
// The owning module provides the implementation.
// The consuming module never imports the implementation — only this interface + token.
//
// Level 2 = read-only query port
// Level 3 = transactional command port (accepts TransactionRef)
//
// @see ARCHITECTURE.md §6 — Cross-module communication

/**
 * Opaque reference to the ambient database transaction.
 *
 * Passed to Level 3 (transactional command port) methods so the owning
 * module's implementation can join the SAME transaction as the caller
 * (e.g. POS checkout must deduct inventory atomically with the sale).
 *
 * The value itself is opaque — only the platform's TransactionManager can
 * mint one (via `TransactionManager.ref()` inside `run()`). Consumers and
 * port implementations receive it; they never construct it.
 *
 * @see ARCHITECTURE.md §6 — Level 3: Transactional command port
 * @see PLAN.md §3.4 — Port registration infrastructure
 */
export interface TransactionRef {
  /** Opaque marker — never construct manually. */
  readonly __transactionRef: unique symbol;
}

/**
 * Port injection token type. Port tokens are stable string names shared
 * between the providing module, the consuming module, and the descriptor's
 * `providesPorts` / `consumesPorts` declarations.
 *
 * Example (Inventory module, PLAN §5.1):
 * ```ts
 * export const INVENTORY_STOCK_PORT = 'INVENTORY_STOCK_PORT' as const;
 *
 * export interface InventoryStockPort {
 *   getAvailability(input: { productVariantIds: string[]; warehouseId: string }): Promise<AvailabilitySnapshot[]>;
 *   reserve(input: ReserveStockInput, tx: TransactionRef): Promise<ReservationRef>;
 *   commitReservation(reservationId: string, tx: TransactionRef): Promise<void>;
 *   releaseReservation(reservationId: string, tx: TransactionRef): Promise<void>;
 * }
 * ```
 */
export type PortToken = string;

// ─── Federated search (PLAN §2.8, §3.3) ─────────────────────────────────────
//
// A search contributor is registered by each module that participates in the
// federated search. When a search query is issued, all registered contributors
// are queried in parallel and results are aggregated.
//
// The contract lives here (not in the platform search module) so that business
// modules can implement it by importing `@modubiz/contracts` alone — modules
// must never import from `platform/`.

/**
 * A search contributor — implemented by each module participating in the
 * federated search.
 *
 * @see ARCHITECTURE.md §6 — Federated search
 */
export interface SearchContributor {
  /** Module key this contributor belongs to. */
  readonly moduleKey: string;

  /** Human-readable label for the result type (i18n key). */
  readonly labelKey: string;

  /**
   * Execute a search query.
   * @param query - The search text
   * @param organizationId - Current organization context
   * @param limit - Max results per contributor
   */
  search(query: string, organizationId: string, limit: number): Promise<SearchResult[]>;
}

/** A single federated-search result item. */
export interface SearchResult {
  /** Unique id within the contributor's scope. */
  id: string;
  /** Display title. */
  title: string;
  /** Optional description / subtitle. */
  description?: string;
  /** URL path to navigate to the result. */
  href: string;
  /** Optional icon identifier. */
  icon?: string;
}

/**
 * Nest DI token for the collection of registered search contributors.
 * The platform search module injects all registered contributors via this
 * token; modules register their contributor through the composition root.
 */
export const SEARCH_CONTRIBUTORS = Symbol('SEARCH_CONTRIBUTORS');

// ─── Inventory stock port (Level 3 — transactional command port) ────────────
//
// Provided by the Inventory module (PLAN §5.6), consumed by POS at checkout
// (POS-15: stock deduction happens inside the sale transaction). Methods
// accept a `TransactionRef` so the implementation joins the caller's ambient
// transaction — never opens its own.
//
// @see ARCHITECTURE.md §6 — Level 3: transactional command port
// @see BUSINESS_RULES.md §8 — INV-5 (available = on-hand − reserved), INV-7/INV-8 (reservations)

/** DI token for the inventory stock port. */
export const INVENTORY_STOCK_PORT = 'INVENTORY_STOCK_PORT' as const;

/** Per-variant availability snapshot for one warehouse. */
export interface AvailabilitySnapshot {
  variantId: string;
  warehouseId: string;
  /** Decimal string of the `numeric(18,4)` on-hand projection (INV-2). */
  quantityOnHand: string;
  /** Decimal string of the reserved quantity (INV-5). */
  quantityReserved: string;
  /** Available = on-hand − reserved (INV-5). Never expose on-hand as "available". */
  quantityAvailable: string;
}

/** Input for `reserve` — the soft hold request (INV-7). */
export interface ReserveStockInput {
  variantId: string;
  warehouseId: string;
  /** Quantity to hold (decimal string, UoM units). */
  quantity: string;
  /** Bounded hold duration in seconds (default 900 = 15 min per INV-7). */
  holdForSeconds?: number;
  /** Who holds it (e.g. a POS draft sale) — `reference_type`/`reference_id` columns. */
  referenceType: string;
  referenceId: string;
  /** Client-generated key so retried reserve calls do not double-hold (INV-16). */
  idempotencyKey?: string;
}

/** Handle to a created reservation. */
export interface ReservationRef {
  reservationId: string;
  /** When the hold auto-expires (ISO 8601). */
  expiresAt: string;
}

/**
 * Input for `restock` — returning stock to a warehouse after a POS refund
 * (POS-22: restocked lines create a `return` movement, damaged lines a
 * `write_off`; either way a movement is recorded).
 */
export interface RestockInput {
  variantId: string;
  warehouseId: string;
  /** Quantity returned (decimal string, UoM units). */
  quantity: string;
  /** true → `return` movement (sellable goods); false → `write_off` (damaged). */
  restock: boolean;
  referenceType: string;
  referenceId: string;
}

/**
 * Optional collector for events raised by a Level 3 port.
 *
 * Port methods run inside the CALLER's transaction, so the providing module
 * cannot publish through its own UnitOfWork (which fires only after ITS
 * transaction commits). Passing a collector — the caller's UnitOfWork — lets
 * the provider register its after-commit events (e.g.
 * `inventory.stock.movement_recorded.v1`) on the caller's unit of work, so
 * they publish when the caller commits. Structurally identical to
 * `UnitOfWork.addEvent` (core/database/unit-of-work.ts).
 */
export interface MovementEventCollector {
  addEvent(event: { name: string; payload: Record<string, unknown>; aggregateId: string }): void;
}

/**
 * Stock availability, reservation, and deduction — the Level 3 port POS
 * consumes inside its checkout transaction (POS-15).
 */
export interface InventoryStockPort {
  /**
   * Availability for one warehouse (INV-5). Read-only; no transaction needed.
   * Fails closed for unknown warehouses (WAREHOUSE_NOT_FOUND).
   */
  getAvailability(input: { variantIds: string[]; warehouseId: string }): Promise<AvailabilitySnapshot[]>;

  /**
   * Create a soft hold (INV-7). Rejects with INSUFFICIENT_STOCK when the
   * requested quantity exceeds available. Accepts `TransactionRef` so the
   * caller's transaction sees the hold atomically.
   */
  reserve(input: ReserveStockInput, tx: TransactionRef): Promise<ReservationRef>;

  /**
   * `held → committed`: deducts on-hand and clears the hold (INV-8). Only
   * legal on a reservation in `held` state.
   */
  commitReservation(reservationId: string, tx: TransactionRef, movementEvents?: MovementEventCollector): Promise<void>;

  /**
   * `held → released`: returns the quantity to available (INV-8).
   */
  releaseReservation(reservationId: string, tx: TransactionRef): Promise<void>;

  /**
   * Create a `return` (restock=true) or `write_off` (restock=false) movement
   * and update the projection — the POS refund path (POS-22). Stock is never
   * silently unchanged: every refund line produces a movement.
   */
  restock(input: RestockInput, tx: TransactionRef, movementEvents?: MovementEventCollector): Promise<void>;
}

// ─── Inventory movement port (Level 3 — transactional command port) ─────────
//
// Provided by the Inventory module (Phase 7.0), consumed by Purchasing (GRN
// receiving, supplier returns, bill cost variance) and Accounting (goods-
// invoice issuance). Like INVENTORY_STOCK_PORT, every method joins the
// caller's ambient transaction via TransactionRef and may collect
// `movement_recorded` events on the caller's unit of work.
//
// @see ARCHITECTURE.md §6 — Level 3: transactional command port
// @see BUSINESS_RULES.md §8 — INV-1 (append-only), INV-5 (available), INV-12 (moving average)
// @see BUSINESS_RULES.md §14 — PUR-4 (GRN→stock), PUR-9 (cost variance), PUR-11 (supplier returns)
// @see BUSINESS_RULES.md §13 — ACC-14 (goods invoice → stock)

/** DI token for the inventory movement port. */
export const INVENTORY_MOVEMENT_PORT = 'INVENTORY_MOVEMENT_PORT' as const;

/** One stock-movement line: what moved, how much, and at what unit cost. */
export interface MovementLineInput {
  variantId: string;
  /** Quantity in UoM units (decimal string, `numeric(18,4)`). */
  quantity: string;
  /** Per-unit cost in minor units — the moving-average input (INV-12). */
  unitCostAmountMinor: string;
  unitCostCurrency: string;
}

/** Input for `receive` — inbound stock (GRN receiving, PUR-4). */
export interface ReceiveMovementInput {
  lines: MovementLineInput[];
  /** Defaults to the org's default warehouse (created lazily on first use). */
  warehouseId?: string;
  /** What caused the receipt, e.g. `purchase_receipt` + GRN id (INV-3). */
  referenceType: string;
  referenceId: string;
  /** Client-generated key so retried receipts cannot double-count (INV-16). */
  idempotencyKey?: string;
}

/** Input for `issue` — stock deduction for a goods invoice (ACC-14). */
export interface IssueMovementInput {
  lines: MovementLineInput[];
  warehouseId?: string;
  /** What caused the deduction, e.g. `sales_invoice` + invoice id. */
  referenceType: string;
  referenceId: string;
  idempotencyKey?: string;
}

/** One supplier-return line (PUR-11). */
export interface SupplierReturnLineInput {
  variantId: string;
  /** Quantity leaving on the return (UoM units). */
  quantity: string;
  /** Optional per-unit cost snapshot; falls back to the variant's current cost. */
  unitCostAmountMinor?: string | null;
  unitCostCurrency?: string | null;
}

/** Input for `returnToSupplier` — stock leaves on a supplier return (PUR-11). */
export interface ReturnToSupplierMovementInput {
  lines: SupplierReturnLineInput[];
  warehouseId?: string;
  /** PUR-11: supplier returns always require a reason code. */
  reasonCode: string;
  referenceType: string;
  referenceId: string;
  idempotencyKey?: string;
}

/** Input for `adjustCost` — bill cost variance (PUR-9, INV-12). */
export interface AdjustCostMovementInput {
  variantId: string;
  warehouseId?: string;
  /**
   * Signed total value adjustment in minor units (e.g. `'-500'` when the
   * bill priced the received goods below the GRN cost).
   */
  costDeltaAmountMinor: string;
  currency: string;
  referenceType: string;
  referenceId: string;
  idempotencyKey?: string;
}

/**
 * Stock movement port (Level 3) — inventory-side mutations that another
 * module's document must be atomic with: GRN receiving, goods-invoice
 * issuance, supplier returns, and bill cost variance. Provided by Inventory;
 * consumed by Purchasing (Phase 8) and Accounting (Phase 7).
 */
export interface InventoryMovementPort {
  /**
   * Receive goods: `receipt` movements, stock up, moving-average cost
   * recalculated (INV-12). One call may carry several lines; the whole batch
   * lands in the caller's transaction.
   */
  receive(input: ReceiveMovementInput, tx: TransactionRef, movementEvents?: MovementEventCollector): Promise<void>;

  /**
   * Issue goods: `sale` movements that deduct stock for an issued invoice
   * (ACC-14). Validates against AVAILABLE stock (INV-5) — an over-issue
   * throws INVENTORY_INSUFFICIENT_STOCK and fails the caller's transaction.
   */
  issue(input: IssueMovementInput, tx: TransactionRef, movementEvents?: MovementEventCollector): Promise<void>;

  /**
   * Return goods to a supplier: `supplier_return` movements that remove
   * stock (PUR-11). Requires a reason code; validates available stock.
   */
  returnToSupplier(
    input: ReturnToSupplierMovementInput,
    tx: TransactionRef,
    movementEvents?: MovementEventCollector,
  ): Promise<void>;

  /**
   * Adjust the value of on-hand stock for a bill cost variance (PUR-9): a
   * `cost_adjustment` movement (quantity 0, INV-3 exemption) that updates the
   * moving average without changing quantity. Rejected when on-hand is zero.
   */
  adjustCost(
    input: AdjustCostMovementInput,
    tx: TransactionRef,
    movementEvents?: MovementEventCollector,
  ): Promise<void>;
}

// ─── Platform read ports (Level 2) ──────────────────────────────────────────
//
// Business modules (crm, inventory, pos) must never import `platform/`
// (architecture test). Reads of platform-owned data go through declared read
// ports: the interface + stable token live here, the implementation lives in
// the owning platform module and is registered in the core PortRegistry
// (PLAN §3.4). A consuming module injects PortRegistry and resolves the token.
//
// @see ARCHITECTURE.md §6 — Level 2: read-only query port

/**
 * A stable snapshot of an FX rate (plain shape — no @modubiz/money import in
 * the contracts package). `rate` is the numeric conversion factor.
 */
export interface FxRateRead {
  rate: number;
  source: string;
  validOn: Date;
}

/**
 * MembershipReadPort — org membership reads (CRM-14 needs active member ids).
 *
 * Implemented by the platform memberships module.
 */
export const MEMBERSHIP_READ_PORT = 'MEMBERSHIP_READ_PORT' as const;
export interface MembershipReadPort {
  /** Ids of ACTIVE, non-deleted members of the organization. */
  listActiveMemberIds(organizationId: string): Promise<string[]>;
}

/**
 * OrganizationReadPort — org profile reads (CRM-8 needs the base currency).
 *
 * Implemented by the platform organizations module.
 */
export const ORGANIZATION_READ_PORT = 'ORGANIZATION_READ_PORT' as const;
export interface OrganizationReadPort {
  /** The organization's base currency (ISO 4217). Throws ORG_NOT_FOUND. */
  getBaseCurrency(organizationId: string): Promise<string>;
}

/**
 * FxRateReadPort — FX rate reads (CRM-8 snapshots the rate at write time).
 *
 * Implemented by the platform fx-rates module.
 */
export const FX_RATE_READ_PORT = 'FX_RATE_READ_PORT' as const;
export interface FxRateReadPort {
  /**
   * Latest rate for a pair (base → quote), or undefined when no snapshot
   * exists (CUR-6: closest prior snapshot). Undefined lets the deal domain
   * decide the error (DEAL_FX_RATE_REQUIRED) instead of a platform 404.
   */
  getRate(baseCurrency: string, quoteCurrency: string): Promise<FxRateRead | undefined>;
}
