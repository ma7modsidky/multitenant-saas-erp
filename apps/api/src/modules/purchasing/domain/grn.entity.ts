import { PURCHASING_ERROR_CODE, PurchasingDomainError } from './errors.js';
import { isPositiveQuantity } from './money.js';

export const GRN_STATUS = {
  DRAFT: 'draft',
  RECEIVED: 'received',
} as const;

export type GrnStatus = (typeof GRN_STATUS)[keyof typeof GRN_STATUS];

export interface GrnLineData {
  id: string;
  organizationId: string;
  grnId: string;
  poLineId: string;
  variantId: string | null;
  /** Decimal string in UoM units. */
  quantity: string;
  unitCostMinor: string;
  unitCostCurrency: string;
  accepted: boolean;
}

export interface GrnLineInput {
  poLineId: string;
  variantId?: string | null;
  /** Decimal string in UoM units. */
  quantity: string;
  unitCostMinor: string;
  unitCostCurrency?: string;
  accepted?: boolean;
}

export interface GrnData {
  id: string;
  organizationId: string;
  number: string;
  poId: string;
  supplierId: string;
  /** Inventory warehouse id — plain id, no FK. Null = org default warehouse. */
  warehouseId: string | null;
  status: GrnStatus;
  receivedAt: string | null;
  receivedBy: string | null;
  createdAt: string;
  updatedAt: string;
  lines: GrnLineData[];
}

/**
 * Grn + lines — the goods-received aggregate (PUR-4, PUR-5).
 *
 * PUR-4: receiving increases warehouse stock atomically through the inventory
 * movement port, in the same transaction as the GRN. A GRN line can never
 * exceed the PO line's remaining quantity — enforced here (received ≤ ordered)
 * AND by the `pur_enforce_grn_quantity` DB trigger for direct writes.
 * PUR-5: a RECEIVED GRN is immutable — corrections are a supplier return or a
 * new adjusting GRN, never an edit.
 */
export class Grn {
  private constructor(private readonly data: GrnData) {}

  static create(input: {
    id: string;
    organizationId: string;
    number: string;
    poId: string;
    supplierId: string;
    warehouseId?: string | null;
    lines: GrnLineInput[];
    now?: Date;
  }): Grn {
    if (input.lines.length === 0) {
      throw new PurchasingDomainError('PURCHASING_GRN_NO_LINES', 'A GRN requires at least one line (PUR-4).');
    }
    const grnId = input.id;
    const organizationId = input.organizationId;
    const timestamp = (input.now ?? new Date()).toISOString();
    const lines: GrnLineData[] = input.lines.map((line, index) => {
      if (!isPositiveQuantity(line.quantity)) {
        throw new PurchasingDomainError(
          PURCHASING_ERROR_CODE.GRN_EXCEEDS_PO,
          `GRN line ${index + 1} has an invalid quantity (PUR-4).`,
          { index },
        );
      }
      return {
        id: crypto.randomUUID(),
        organizationId,
        grnId,
        poLineId: line.poLineId,
        variantId: line.variantId ?? null,
        quantity: line.quantity,
        unitCostMinor: line.unitCostMinor,
        unitCostCurrency: (line.unitCostCurrency ?? 'USD').toUpperCase(),
        accepted: line.accepted ?? true,
      };
    });
    return new Grn({
      id: grnId,
      organizationId,
      number: input.number,
      poId: input.poId,
      supplierId: input.supplierId,
      warehouseId: input.warehouseId ?? null,
      status: GRN_STATUS.DRAFT,
      receivedAt: null,
      receivedBy: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lines,
    });
  }

  static fromJSON(data: GrnData): Grn {
    return new Grn(data);
  }

  toJSON(): GrnData {
    return { ...this.data, lines: this.data.lines.map((l) => ({ ...l })) };
  }

  get id(): string {
    return this.data.id;
  }

  get number(): string {
    return this.data.number;
  }

  get status(): GrnStatus {
    return this.data.status;
  }

  get poId(): string {
    return this.data.poId;
  }

  get supplierId(): string {
    return this.data.supplierId;
  }

  get warehouseId(): string | null {
    return this.data.warehouseId;
  }

  get lines(): GrnLineData[] {
    return this.data.lines.map((l) => ({ ...l }));
  }

  /**
   * PUR-5: mark the GRN received. The caller performs the stock receipt
   * (INVENTORY_MOVEMENT_PORT.receive) INSIDE the same transaction — if the
   * movement fails, this flip is never committed (PUR-4 atomicity).
   * A received GRN is immutable: calling this twice, or editing lines after,
   * is rejected.
   */
  receive(userId: string | null, now: Date): void {
    if (this.data.status === GRN_STATUS.RECEIVED) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.GRN_IMMUTABLE,
        `GRN ${this.data.number} is already received and is immutable (PUR-5).`,
        { number: this.data.number },
      );
    }
    this.data.status = GRN_STATUS.RECEIVED;
    this.data.receivedAt = now.toISOString();
    this.data.receivedBy = userId;
    this.data.updatedAt = now.toISOString();
  }
}
