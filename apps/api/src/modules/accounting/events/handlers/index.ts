// Event handlers for the accounting module.
// Handlers validate the payload, delegate to a use case, and stay idempotent.

export { PosSaleCompletedHandler } from './pos-sale-completed.handler.js';
export { InventoryMovementRecordedHandler } from './inventory-movement-recorded.handler.js';
export { PurchasingBillApprovedHandler } from './purchasing-bill-approved.handler.js';
export { PurchasingPaymentRecordedHandler } from './purchasing-payment-recorded.handler.js';
export { PurchasingSupplierReturnApprovedHandler } from './purchasing-supplier-return-approved.handler.js';
