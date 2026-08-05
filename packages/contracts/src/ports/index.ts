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
  commitReservation(reservationId: string, tx: TransactionRef): Promise<void>;

  /**
   * `held → released`: returns the quantity to available (INV-8).
   */
  releaseReservation(reservationId: string, tx: TransactionRef): Promise<void>;
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
