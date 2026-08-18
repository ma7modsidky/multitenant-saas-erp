import { PURCHASING_ERROR_CODE, PurchasingDomainError } from './errors.js';
import {
  computeLineTax,
  computeLineTotal,
  formatQuantity,
  isNonNegativeMinor,
  isPositiveQuantity,
  parseQuantity,
  sumMinor,
} from './money.js';

export const PO_STATUS = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  PARTIALLY_RECEIVED: 'partially_received',
  RECEIVED: 'received',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
} as const;

export type PoStatus = (typeof PO_STATUS)[keyof typeof PO_STATUS];

export interface PoLineData {
  id: string;
  organizationId: string;
  poId: string;
  /** PUR-8: inventory variant id, no FK. Null for service lines. */
  variantId: string | null;
  itemNameSnapshot: string;
  /** Decimal string in UoM units (numeric(18,4)). */
  quantity: string;
  /** PUR-4: running projection of received quantity (never exceeds quantity). */
  receivedQuantity: string;
  unitCostMinor: string;
  unitCostCurrency: string;
  discountMinor: string;
  taxRateBpSnapshot: number;
  lineTotalMinor: string;
}

export interface PoLineInput {
  variantId?: string | null;
  itemNameSnapshot: string;
  /** Decimal string in UoM units. */
  quantity?: string;
  unitCostMinor: string;
  unitCostCurrency?: string;
  discountMinor?: string;
  taxRateBpSnapshot?: number;
}

export interface PurchaseOrderData {
  id: string;
  organizationId: string;
  number: string;
  supplierId: string;
  status: PoStatus;
  orderDate: string;
  expectedDate: string | null;
  currency: string;
  subtotalMinor: string;
  discountMinor: string;
  taxMinor: string;
  totalMinor: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lines: PoLineData[];
}

/**
 * PurchaseOrder + lines — the PO aggregate (PUR-3, PUR-8).
 *
 * PUR-3 lifecycle: Draft → Pending Approval → Approved → Partially Received →
 * Received → Closed. A PO with any receipt cannot be cancelled. Every status
 * transition is audited by the use case.
 * PUR-8: lines reference inventory variants by id WITHOUT a FK, or are service
 * lines; name + unit cost are snapshotted so historical documents stay
 * reproducible.
 */
export class PurchaseOrder {
  private constructor(private readonly data: PurchaseOrderData) {}

  static create(input: {
    id: string;
    organizationId: string;
    number: string;
    supplierId: string;
    currency: string;
    orderDate?: string;
    expectedDate?: string | null;
    notes?: string | null;
    status?: PoStatus;
    lines: PoLineInput[];
    now?: Date;
  }): PurchaseOrder {
    const currency = input.currency.toUpperCase();
    const poId = input.id;
    const organizationId = input.organizationId;

    if (input.lines.length === 0) {
      throw new PurchasingDomainError('PURCHASING_PO_NO_LINES', 'A purchase order requires at least one line (PUR-8).');
    }

    const lines: PoLineData[] = input.lines.map((line, index) => {
      const quantity = line.quantity ?? '1';
      const discount = line.discountMinor ?? '0';
      if (!isPositiveQuantity(quantity)) {
        throw new PurchasingDomainError(
          PURCHASING_ERROR_CODE.NOT_FOUND,
          `PO line ${index + 1} has an invalid quantity (PUR-8).`,
          { index },
        );
      }
      if (!isNonNegativeMinor(line.unitCostMinor)) {
        throw new PurchasingDomainError(
          PURCHASING_ERROR_CODE.NOT_FOUND,
          `PO line ${index + 1} has a negative unit cost (PUR-8).`,
          { index },
        );
      }
      const lineTotal = computeLineTotal(line.unitCostMinor, quantity, discount);
      return {
        id: crypto.randomUUID(),
        organizationId,
        poId,
        variantId: line.variantId ?? null,
        itemNameSnapshot: line.itemNameSnapshot,
        quantity,
        receivedQuantity: '0',
        unitCostMinor: line.unitCostMinor,
        unitCostCurrency: (line.unitCostCurrency ?? currency).toUpperCase(),
        discountMinor: discount,
        taxRateBpSnapshot: Math.max(0, Math.trunc(line.taxRateBpSnapshot ?? 0)),
        lineTotalMinor: lineTotal,
      };
    });

    const subtotal = sumMinor(lines.map((l) => l.lineTotalMinor));
    const tax = sumMinor(lines.map((l) => computeLineTax(l.lineTotalMinor, l.taxRateBpSnapshot)));
    const total = (BigInt(subtotal) + BigInt(tax)).toString();

    const timestamp = (input.now ?? new Date()).toISOString();
    const today = (input.now ?? new Date()).toISOString().slice(0, 10);
    return new PurchaseOrder({
      id: poId,
      organizationId,
      number: input.number,
      supplierId: input.supplierId,
      status: input.status ?? PO_STATUS.DRAFT,
      orderDate: input.orderDate ?? today,
      expectedDate: input.expectedDate ?? null,
      currency,
      subtotalMinor: subtotal,
      discountMinor: '0',
      taxMinor: tax,
      totalMinor: total,
      notes: input.notes ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lines,
    });
  }

  static fromJSON(data: PurchaseOrderData): PurchaseOrder {
    return new PurchaseOrder(data);
  }

  toJSON(): PurchaseOrderData {
    return { ...this.data, lines: this.data.lines.map((l) => ({ ...l })) };
  }

  get id(): string {
    return this.data.id;
  }

  get number(): string {
    return this.data.number;
  }

  get status(): PoStatus {
    return this.data.status;
  }

  get supplierId(): string {
    return this.data.supplierId;
  }

  get totalMinor(): string {
    return this.data.totalMinor;
  }

  get currency(): string {
    return this.data.currency;
  }

  get lines(): PoLineData[] {
    return this.data.lines.map((l) => ({ ...l }));
  }

  get hasReceipts(): boolean {
    return this.data.lines.some((l) => BigInt(l.receivedQuantity) > 0n);
  }

  /** PUR-3: the sanctioned transition table. */
  transitionTo(next: PoStatus, now: Date): void {
    const legal: Record<PoStatus, PoStatus[]> = {
      [PO_STATUS.DRAFT]: [PO_STATUS.PENDING_APPROVAL, PO_STATUS.CANCELLED],
      [PO_STATUS.PENDING_APPROVAL]: [PO_STATUS.APPROVED, PO_STATUS.CANCELLED],
      [PO_STATUS.APPROVED]: [PO_STATUS.PARTIALLY_RECEIVED, PO_STATUS.RECEIVED, PO_STATUS.CLOSED],
      [PO_STATUS.PARTIALLY_RECEIVED]: [PO_STATUS.RECEIVED, PO_STATUS.CLOSED],
      [PO_STATUS.RECEIVED]: [PO_STATUS.CLOSED],
      [PO_STATUS.CLOSED]: [],
      [PO_STATUS.CANCELLED]: [],
    };
    if (!legal[this.data.status].includes(next)) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.PO_ILLEGAL_TRANSITION,
        `Illegal PO status transition ${this.data.status} → ${next} (PUR-3).`,
        { from: this.data.status, to: next },
      );
    }
    // PUR-3: a PO with any receipt cannot be cancelled.
    if (next === PO_STATUS.CANCELLED && this.hasReceipts) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.PO_HAS_RECEIPTS,
        `PO ${this.data.number} has receipts and cannot be cancelled (PUR-3).`,
        { number: this.data.number },
      );
    }
    this.data.status = next;
    this.data.updatedAt = now.toISOString();
  }

  /** PUR-4: record a GRN line's quantity on the referenced PO line. */
  applyReceived(poLineId: string, quantity: string): void {
    const line = this.data.lines.find((l) => l.id === poLineId);
    if (!line) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.NOT_FOUND,
        `PO line ${poLineId} not found on PO ${this.data.number} (PUR-4).`,
        { poLineId },
      );
    }
    // PUR-4: received can never exceed the ordered quantity.
    const received = parseQuantity(line.receivedQuantity);
    const ordered = parseQuantity(line.quantity);
    const newReceived = received + parseQuantity(quantity);
    if (newReceived > ordered) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.GRN_EXCEEDS_PO,
        `GRN would push received ${formatQuantity(received)} past ordered ${line.quantity} on PO line ${poLineId} (PUR-4).`,
        { poLineId },
      );
    }
    line.receivedQuantity = formatQuantity(newReceived);
  }
}
