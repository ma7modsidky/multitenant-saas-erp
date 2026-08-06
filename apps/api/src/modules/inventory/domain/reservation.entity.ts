import { InventoryError, INVENTORY_ERROR_CODE } from './errors.js';

/** Reservation states (inv_stock_reservations.state). */
export const RESERVATION_STATE = {
  HELD: 'held',
  COMMITTED: 'committed',
  RELEASED: 'released',
  EXPIRED: 'expired',
} as const;

export type ReservationState = (typeof RESERVATION_STATE)[keyof typeof RESERVATION_STATE];

/** Persisted shape of a reservation (inv_stock_reservations). */
export interface ReservationData {
  id: string;
  organizationId: string;
  variantId: string;
  warehouseId: string;
  quantity: string;
  state: ReservationState;
  expiresAt: Date;
  referenceType: string;
  referenceId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Reservation — a soft hold on available stock.
 *
 * Rules enforced here:
 * - INV-7: the hold is bounded (`expires_at`, default 15 minutes) and expires
 *   automatically; a job releases expired reservations.
 * - INV-8: transitions are `held → committed` (stock deducted), `held →
 *   released` (returned to available) or `held → expired`. No other
 *   transition is legal.
 */
export class Reservation {
  private constructor(private readonly data: ReservationData) {}

  static create(data: ReservationData): Reservation {
    return new Reservation({ ...data });
  }

  static fromPersistence(data: ReservationData): Reservation {
    return new Reservation(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get variantId(): string {
    return this.data.variantId;
  }
  get warehouseId(): string {
    return this.data.warehouseId;
  }
  get quantity(): string {
    return this.data.quantity;
  }
  get state(): ReservationState {
    return this.data.state;
  }
  get expiresAt(): Date {
    return this.data.expiresAt;
  }
  get referenceType(): string {
    return this.data.referenceType;
  }
  get referenceId(): string {
    return this.data.referenceId;
  }

  toJSON(): ReservationData {
    return { ...this.data };
  }

  // ─── Transitions (INV-8) ────────────────────────────────────────────────────

  /** `held → committed`: stock is deducted; the hold is cleared. */
  commit(now = new Date()): void {
    this.assertTransition(RESERVATION_STATE.COMMITTED, now);
    this.data.state = RESERVATION_STATE.COMMITTED;
    this.data.updatedAt = now;
  }

  /** `held → released`: the quantity returns to available. */
  release(now = new Date()): void {
    this.assertTransition(RESERVATION_STATE.RELEASED, now);
    this.data.state = RESERVATION_STATE.RELEASED;
    this.data.updatedAt = now;
  }

  /**
   * `held → expired` (INV-7): called by the expiry job for holds past their
   * bound. Releases the quantity back to available.
   */
  expire(now = new Date()): void {
    if (this.data.state !== RESERVATION_STATE.HELD) {
      throw new InventoryError(
        INVENTORY_ERROR_CODE.RESERVATION_ILLEGAL_TRANSITION,
        `A reservation in state "${this.data.state}" cannot expire.`,
        { reservationId: this.data.id, state: this.data.state },
      );
    }
    this.data.state = RESERVATION_STATE.EXPIRED;
    this.data.updatedAt = now;
  }

  /** True when the hold bound has passed (INV-7). */
  isExpired(now = new Date()): boolean {
    return this.data.state === RESERVATION_STATE.HELD && this.data.expiresAt.getTime() <= now.getTime();
  }

  private assertTransition(to: ReservationState, now: Date): void {
    if (this.data.state !== RESERVATION_STATE.HELD) {
      throw new InventoryError(
        INVENTORY_ERROR_CODE.RESERVATION_ILLEGAL_TRANSITION,
        `A reservation in state "${this.data.state}" cannot transition to "${to}".`,
        { reservationId: this.data.id, state: this.data.state, to },
      );
    }
    if (this.data.expiresAt.getTime() <= now.getTime()) {
      throw new InventoryError(
        INVENTORY_ERROR_CODE.RESERVATION_EXPIRED,
        'This reservation has expired; it can only be marked expired.',
        { reservationId: this.data.id },
      );
    }
  }
}
