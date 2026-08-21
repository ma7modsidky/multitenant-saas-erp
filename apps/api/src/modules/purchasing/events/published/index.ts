// Published event payload builders for the purchasing module.
//
// Every builder returns the exact payload shape declared in
// @modubiz/contracts (events/purchasing.ts). The use cases publish these AFTER
// the transaction commits (UnitOfWork) so handlers never observe uncommitted
// state (OPS-3). Accounting consumes them to post AP journal entries
// idempotently, keyed on the document id (ACC-15).
import {
  PURCHASING_EVENTS,
  type PurchasingBillApprovedV1,
  type PurchasingGrnReceivedV1,
  type PurchasingPaymentRecordedV1,
  type PurchasingPoApprovedV1,
  type PurchasingSupplierCreatedV1,
  type PurchasingSupplierReturnApprovedV1,
} from '@modubiz/contracts';

import type { DomainEvent } from '../../../../core/database/unit-of-work.js';

/** The event shape UnitOfWork.addEvent accepts (occurredAt is stamped on add). */
type PublishedEvent = Omit<DomainEvent, 'occurredAt'>;

export function buildSupplierCreatedEvent(
  organizationId: string,
  supplierId: string,
  name: string,
  taxId: string | null,
  currency: string,
  occurredAt: Date,
): PublishedEvent {
  const payload: PurchasingSupplierCreatedV1 = {
    organizationId,
    supplierId,
    supplierName: name,
    taxId,
    currency,
    occurredAt: occurredAt.toISOString(),
  };
  return {
    name: PURCHASING_EVENTS.SUPPLIER_CREATED_V1,
    payload,
    aggregateId: supplierId,
  };
}

export function buildPoApprovedEvent(
  organizationId: string,
  poId: string,
  poNumber: string,
  supplierId: string,
  totalAmountMinor: string,
  currency: string,
  approvedAt: Date,
): PublishedEvent {
  const payload: PurchasingPoApprovedV1 = {
    organizationId,
    poId,
    poNumber,
    supplierId,
    totalAmountMinor,
    currency,
    approvedAt: approvedAt.toISOString(),
    occurredAt: approvedAt.toISOString(),
  };
  return {
    name: PURCHASING_EVENTS.PO_APPROVED_V1,
    payload,
    aggregateId: poId,
  };
}

export function buildGrnReceivedEvent(
  organizationId: string,
  grnId: string,
  grnNumber: string,
  poId: string,
  supplierId: string,
  warehouseId: string | null,
  lineCount: number,
  receivedAt: Date,
): PublishedEvent {
  const payload: PurchasingGrnReceivedV1 = {
    organizationId,
    grnId,
    grnNumber,
    poId,
    supplierId,
    warehouseId,
    lineCount,
    receivedAt: receivedAt.toISOString(),
    occurredAt: receivedAt.toISOString(),
  };
  return {
    name: PURCHASING_EVENTS.GRN_RECEIVED_V1,
    payload,
    aggregateId: grnId,
  };
}

export function buildBillApprovedEvent(
  organizationId: string,
  billId: string,
  billNumber: string,
  supplierId: string,
  money: {
    subtotalAmountMinor: string;
    discountAmountMinor: string;
    taxAmountMinor: string;
    totalAmountMinor: string;
    currency: string;
  },
  lines: Array<{
    variantId: string | null;
    quantity: string;
    unitCostAmountMinor: string;
    taxRateBpSnapshot: number;
  }>,
  billDate: string,
  dueDate: string | null,
  approvedAt: Date,
): PublishedEvent {
  const payload: PurchasingBillApprovedV1 = {
    organizationId,
    billId,
    billNumber,
    supplierId,
    subtotalAmountMinor: money.subtotalAmountMinor,
    discountAmountMinor: money.discountAmountMinor,
    taxAmountMinor: money.taxAmountMinor,
    totalAmountMinor: money.totalAmountMinor,
    currency: money.currency,
    lines: lines.map((l) => ({
      ...(l.variantId !== null ? { variantId: l.variantId } : {}),
      quantity: l.quantity,
      unitCostAmountMinor: l.unitCostAmountMinor,
      taxRateBpSnapshot: l.taxRateBpSnapshot,
    })),
    billDate: `${billDate}T00:00:00.000Z`,
    dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : `${billDate}T00:00:00.000Z`,
    approvedAt: approvedAt.toISOString(),
    occurredAt: approvedAt.toISOString(),
  };
  return {
    name: PURCHASING_EVENTS.BILL_APPROVED_V1,
    payload,
    aggregateId: billId,
  };
}

export function buildPaymentRecordedEvent(
  organizationId: string,
  paymentId: string,
  paymentNumber: string,
  supplierId: string,
  method: 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other',
  amountMinor: string,
  currency: string,
  allocationCount: number,
  paidAt: Date,
): PublishedEvent {
  const payload: PurchasingPaymentRecordedV1 = {
    organizationId,
    paymentId,
    paymentNumber,
    supplierId,
    method,
    amountMinor,
    currency,
    allocationCount,
    paidAt: paidAt.toISOString(),
    occurredAt: paidAt.toISOString(),
  };
  return {
    name: PURCHASING_EVENTS.PAYMENT_RECORDED_V1,
    payload,
    aggregateId: paymentId,
  };
}

export function buildSupplierReturnApprovedEvent(
  organizationId: string,
  returnId: string,
  returnNumber: string,
  supplierId: string,
  billId: string | null,
  reasonCode: string,
  /** Positive returned value; carried negative in the AP direction (PUR-2). */
  amountMinor: string,
  currency: string,
  /** ACC-11: return tax total (Σ line taxes). */
  taxMinor: string,
  /** ACC-11: supplier tax id snapshot from the source bill. */
  supplierTaxIdSnapshot: string | null,
  lines: Array<{
    variantId: string | null;
    quantity: string;
    unitCostAmountMinor: string;
    taxRateBpSnapshot: number;
    taxAmountMinor: string;
  }>,
  returnedAt: Date,
): PublishedEvent {
  const payload: PurchasingSupplierReturnApprovedV1 = {
    organizationId,
    returnId,
    returnNumber,
    supplierId,
    billId,
    reasonCode,
    // PUR-2: a debit note reduces AP — signed negative.
    amountMinor: `-${amountMinor.replace(/^-/, '')}`,
    taxMinor,
    totalMinor: `-${(BigInt(amountMinor) + BigInt(taxMinor)).toString()}`,
    supplierTaxIdSnapshot,
    currency,
    lines: lines.map((l) => ({
      ...(l.variantId !== null ? { variantId: l.variantId } : {}),
      quantity: l.quantity,
      unitCostAmountMinor: l.unitCostAmountMinor,
      ...(l.taxRateBpSnapshot > 0 ? { taxRateBpSnapshot: l.taxRateBpSnapshot } : {}),
      ...(BigInt(l.taxAmountMinor) !== 0n ? { taxAmountMinor: l.taxAmountMinor } : {}),
    })),
    returnedAt: returnedAt.toISOString(),
    occurredAt: returnedAt.toISOString(),
  };
  return {
    name: PURCHASING_EVENTS.SUPPLIER_RETURN_APPROVED_V1,
    payload,
    aggregateId: returnId,
  };
}
