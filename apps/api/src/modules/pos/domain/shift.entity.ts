import { PosError, POS_ERROR_CODE } from './errors.js';
import { parseMinor } from './money.js';

/** Shift states (pos_shifts.status). */
export const SHIFT_STATUS = {
  OPEN: 'open',
  CLOSED: 'closed',
} as const;

export type ShiftStatus = (typeof SHIFT_STATUS)[keyof typeof SHIFT_STATUS];

/** Persisted shape of a shift (pos_shifts). */
export interface ShiftData {
  id: string;
  organizationId: string;
  registerId: string;
  openedBy: string;
  openedAt: Date;
  openingFloatAmountMinor: string;
  closedBy: string | null;
  closedAt: Date | null;
  countedCashAmountMinor: string | null;
  expectedCashAmountMinor: string | null;
  varianceAmountMinor: string | null;
  currency: string;
  status: ShiftStatus;
  /** POS-7: manager force-close despite unsynced offline sales. */
  forcedClose: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CloseShiftInput {
  countedCashAmountMinor: string;
  /** Σ cash payments made during the shift (minor units). */
  cashSalesAmountMinor: string;
  /** Σ refunds issued during the shift (minor units). */
  cashRefundsAmountMinor: string;
  /** POS-7: true when a MANAGER force-closed with unsynced offline sales. */
  forcedClose: boolean;
  closedBy: string;
  now: Date;
}

/**
 * Shift (pos_shifts) — a cash session on a register.
 *
 * Rules enforced here:
 * - POS-4: opening records the opening float and the operator.
 * - POS-5: closing computes expected cash = opening float + cash sales − cash
 *   refunds, stores the variance = counted − expected, and locks the shift.
 * - POS-6: a closed shift is immutable — no further mutations.
 * - POS-2: only one open shift per register (enforced by the partial unique
 *   index in the database and re-checked by the repository before insert).
 */
export class Shift {
  private constructor(private readonly data: ShiftData) {}

  /** POS-4 — opening a shift records the float and the operator. */
  static create(data: ShiftData): Shift {
    return new Shift({ ...data });
  }

  static fromPersistence(data: ShiftData): Shift {
    return new Shift(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get registerId(): string {
    return this.data.registerId;
  }
  get openedBy(): string {
    return this.data.openedBy;
  }
  get openedAt(): Date {
    return this.data.openedAt;
  }
  get openingFloatAmountMinor(): string {
    return this.data.openingFloatAmountMinor;
  }
  get currency(): string {
    return this.data.currency;
  }
  get status(): ShiftStatus {
    return this.data.status;
  }
  get closedAt(): Date | null {
    return this.data.closedAt;
  }
  get expectedCashAmountMinor(): string | null {
    return this.data.expectedCashAmountMinor;
  }
  get varianceAmountMinor(): string | null {
    return this.data.varianceAmountMinor;
  }
  get forcedClose(): boolean {
    return this.data.forcedClose;
  }

  /** POS-3 / POS-23 guard — selling or refunding requires an open shift. */
  assertOpen(): void {
    if (this.data.status !== SHIFT_STATUS.OPEN) {
      throw new PosError(POS_ERROR_CODE.NO_OPEN_SHIFT, 'Selling requires an open shift on the register.', {
        shiftId: this.data.id,
      });
    }
  }

  /**
   * POS-5 + POS-6 — closes the shift. Throws when already closed (immutable).
   *
   * expected = opening float + cash sales − cash refunds (POS-5)
   * variance = counted − expected (negative = shortage)
   */
  close(input: CloseShiftInput): void {
    if (this.data.status === SHIFT_STATUS.CLOSED) {
      throw new PosError(POS_ERROR_CODE.SHIFT_CLOSED_IMMUTABLE, 'A closed shift is immutable (POS-6).', {
        shiftId: this.data.id,
      });
    }
    const expected =
      parseMinor(this.data.openingFloatAmountMinor) +
      parseMinor(input.cashSalesAmountMinor) -
      parseMinor(input.cashRefundsAmountMinor);
    const counted = parseMinor(input.countedCashAmountMinor);
    const variance = counted - expected;

    this.data.status = SHIFT_STATUS.CLOSED;
    this.data.closedBy = input.closedBy;
    this.data.closedAt = input.now;
    this.data.countedCashAmountMinor = input.countedCashAmountMinor;
    this.data.expectedCashAmountMinor = expected.toString();
    this.data.varianceAmountMinor = variance.toString();
    this.data.forcedClose = input.forcedClose;
    this.data.updatedAt = input.now;
    this.data.updatedBy = input.closedBy;
  }

  toJSON(): ShiftData {
    return { ...this.data };
  }
}
