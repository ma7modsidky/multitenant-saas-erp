import { PURCHASING_ERROR_CODE, PurchasingDomainError } from './errors.js';

export const REQUISITION_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
} as const;

export type RequisitionStatus = (typeof REQUISITION_STATUS)[keyof typeof REQUISITION_STATUS];

export interface RequisitionLineData {
  id: string;
  organizationId: string;
  requisitionId: string;
  variantId: string | null;
  itemNameSnapshot: string;
  quantity: string;
  estimatedUnitCostMinor: string;
  estimatedUnitCostCurrency: string;
}

export interface RequisitionLineInput {
  variantId?: string | null;
  itemNameSnapshot: string;
  quantity: string;
  estimatedUnitCostMinor?: string;
  estimatedUnitCostCurrency?: string;
}

export interface RequisitionData {
  id: string;
  organizationId: string;
  number: string;
  status: RequisitionStatus;
  requestedBy: string | null;
  requiredByDate: string | null;
  notes: string | null;
  /** PUR-12: when purchase_approval is enabled, the multi-step chain. */
  approvalChain: Array<{ approverUserId: string; decidedAt: string | null; approved: boolean | null }> | null;
  createdAt: string;
  updatedAt: string;
  lines: RequisitionLineData[];
}

/**
 * Requisition (optional intake step of purchase-to-pay, PUR-12).
 *
 * PUR-12: purchase approval is PLAN-GATED (`purchasing.purchase_approval`):
 * feature OFF ⇒ an authorized user approves inline (submit flips straight to
 * approved); feature ON ⇒ a multi-step approval chain, audited. Enforcement is
 * server-side from the entitlement's feature set; the use case decides which
 * path by consulting the feature flag — never client state.
 */
export class Requisition {
  private constructor(private readonly data: RequisitionData) {}

  static create(input: {
    id: string;
    organizationId: string;
    number: string;
    requestedBy?: string | null;
    requiredByDate?: string | null;
    notes?: string | null;
    lines: RequisitionLineInput[];
    now?: Date;
  }): Requisition {
    if (input.lines.length === 0) {
      throw new PurchasingDomainError(
        'PURCHASING_REQUISITION_NO_LINES',
        'A requisition requires at least one line (PUR-12).',
      );
    }
    const timestamp = (input.now ?? new Date()).toISOString();
    const requisitionId = input.id;
    const lines: RequisitionLineData[] = input.lines.map((line) => ({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      requisitionId,
      variantId: line.variantId ?? null,
      itemNameSnapshot: line.itemNameSnapshot,
      quantity: line.quantity,
      estimatedUnitCostMinor: line.estimatedUnitCostMinor ?? '0',
      estimatedUnitCostCurrency: (line.estimatedUnitCostCurrency ?? 'USD').toUpperCase(),
    }));
    return new Requisition({
      id: requisitionId,
      organizationId: input.organizationId,
      number: input.number,
      status: REQUISITION_STATUS.DRAFT,
      requestedBy: input.requestedBy ?? null,
      requiredByDate: input.requiredByDate ?? null,
      notes: input.notes ?? null,
      approvalChain: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lines,
    });
  }

  static fromJSON(data: RequisitionData): Requisition {
    return new Requisition(data);
  }

  toJSON(): RequisitionData {
    return { ...this.data, lines: this.data.lines.map((l) => ({ ...l })) };
  }

  get id(): string {
    return this.data.id;
  }

  get number(): string {
    return this.data.number;
  }

  get status(): RequisitionStatus {
    return this.data.status;
  }

  get lines(): RequisitionLineData[] {
    return this.data.lines.map((l) => ({ ...l }));
  }

  /**
   * PUR-12: submit the requisition. With the approval feature ON the status
   * becomes `submitted` awaiting a chain; with it OFF the caller approves
   * inline and the status flips straight to `approved` (no chain steps).
   */
  submit(now: Date): void {
    if (this.data.status !== REQUISITION_STATUS.DRAFT) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.APPROVAL_REQUIRED,
        `Requisition ${this.data.number} is ${this.data.status}; only a draft can be submitted (PUR-12).`,
        { number: this.data.number, status: this.data.status },
      );
    }
    this.data.status = REQUISITION_STATUS.SUBMITTED;
    this.data.updatedAt = now.toISOString();
  }

  /** PUR-12: approve inline (feature OFF path) or a chain step (feature ON). */
  approve(now: Date): void {
    if (this.data.status !== REQUISITION_STATUS.SUBMITTED && this.data.status !== REQUISITION_STATUS.DRAFT) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.APPROVAL_REQUIRED,
        `Requisition ${this.data.number} is ${this.data.status}; it cannot be approved now (PUR-12).`,
        { number: this.data.number, status: this.data.status },
      );
    }
    this.data.status = REQUISITION_STATUS.APPROVED;
    this.data.updatedAt = now.toISOString();
  }
}
