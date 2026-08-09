import { PosError, POS_ERROR_CODE } from './errors.js';

/**
 * Register (pos_registers) — a till bound to exactly one warehouse (POS-1).
 *
 * All stock movements from a register's sales affect that warehouse. The
 * register's currency is the organization's base currency (resolved at the API
 * layer, DATA_MODEL.md §9 — the register carries no currency column).
 */
export interface RegisterData {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  /** POS-1: the single warehouse all sales from this register hit. */
  warehouseId: string;
  receiptPrefix: string;
  /** POS-9: the next receipt number to allocate (atomic in the repository). */
  nextReceiptNumber: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class Register {
  private constructor(private readonly data: RegisterData) {}

  static create(data: RegisterData): Register {
    // POS-1: a register is bound to exactly one warehouse.
    if (!data.warehouseId) {
      throw new PosError(POS_ERROR_CODE.REGISTER_NOT_FOUND, 'A register must be bound to a warehouse (POS-1).');
    }
    if (!data.name.trim() || !data.code.trim()) {
      throw new PosError(POS_ERROR_CODE.REGISTER_NOT_FOUND, 'A register requires a name and a code.');
    }
    return new Register({ ...data });
  }

  static fromPersistence(data: RegisterData): Register {
    return new Register(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get name(): string {
    return this.data.name;
  }
  get code(): string {
    return this.data.code;
  }
  get warehouseId(): string {
    return this.data.warehouseId;
  }
  get receiptPrefix(): string {
    return this.data.receiptPrefix;
  }
  get nextReceiptNumber(): number {
    return this.data.nextReceiptNumber;
  }
  get isActive(): boolean {
    return this.data.isActive;
  }

  /**
   * Formats a receipt number (POS-9). The numeric part is zero-padded to four
   * digits (R-0001), giving a stable, sortable string for the unique index.
   */
  formatReceiptNumber(sequence: number): string {
    return `${this.data.receiptPrefix}-${String(sequence).padStart(4, '0')}`;
  }

  assertSellable(): void {
    if (!this.data.isActive) {
      throw new PosError(POS_ERROR_CODE.REGISTER_INACTIVE, 'This register is deactivated.', {
        registerId: this.data.id,
      });
    }
  }

  toJSON(): RegisterData {
    return { ...this.data };
  }
}
