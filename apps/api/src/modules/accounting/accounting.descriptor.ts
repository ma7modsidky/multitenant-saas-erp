import {
  ACCOUNTING_EVENTS,
  POS_EVENTS,
  INVENTORY_EVENTS,
  PURCHASING_EVENTS,
  defineModule,
  type ModuleDescriptor,
} from '@modubiz/contracts';

/**
 * Accounting module descriptor — the entire integration surface with the platform.
 *
 * Double-entry bookkeeping (general ledger), customer invoicing with a full
 * accounts-receivable lifecycle, tax and e-invoicing readiness, and automatic
 * GL posting from subledger events (POS sales, inventory movements, and — from
 * Phase 8 — purchasing bills/payments/supplier returns). The books are
 * immutable from day one: posted entries are only ever reversed (ACC-2).
 *
 * @see MODULE_GUIDE.md §2 — Descriptor rules
 * @see PLAN.md §7 — Accounting & Invoicing module (full stack)
 */
export const accountingDescriptor: ModuleDescriptor = defineModule({
  key: 'accounting',
  version: '1.0.0',
  nameKey: 'modules.accounting.name',
  descriptionKey: 'modules.accounting.description',
  icon: 'accounting',
  tablePrefix: 'acc_',
  // Inventory and POS are OPTIONAL at runtime — entitlement-gated, never a
  // hard boot dependency: without inventory, accounting runs in
  // service-invoice-only mode (ACC-14, POS-18 pattern).
  dependsOn: [],
  stripePriceKey: 'price_accounting_monthly',
  trialDays: 14,
  permissions: [
    'accounting:coa:manage',
    'accounting:tax:manage',
    'accounting:journal:post',
    'accounting:invoice:read',
    'accounting:invoice:write',
    'accounting:payment:apply',
    'accounting:credit-note:issue',
    'accounting:report:view',
    'accounting:settings:manage',
  ],
  navigation: [
    {
      labelKey: 'modules.accounting.nav.coa',
      href: '/m/accounting/coa',
      icon: 'book-open',
    },
    {
      labelKey: 'modules.accounting.nav.journal',
      href: '/m/accounting/journal',
      icon: 'notebook',
    },
    {
      labelKey: 'modules.accounting.nav.invoices',
      href: '/m/accounting/invoices',
      icon: 'file-text',
    },
    {
      labelKey: 'modules.accounting.nav.payments',
      href: '/m/accounting/payments',
      icon: 'wallet',
    },
    {
      labelKey: 'modules.accounting.nav.creditNotes',
      href: '/m/accounting/credit-notes',
      icon: 'undo',
    },
    {
      labelKey: 'modules.accounting.nav.reports',
      href: '/m/accounting/reports',
      icon: 'bar-chart',
    },
  ],
  publishes: [
    ACCOUNTING_EVENTS.INVOICE_ISSUED_V1,
    ACCOUNTING_EVENTS.INVOICE_PAID_V1,
    ACCOUNTING_EVENTS.CREDIT_NOTE_ISSUED_V1,
    ACCOUNTING_EVENTS.JOURNAL_POSTED_V1,
    ACCOUNTING_EVENTS.PAYMENT_RECEIVED_V1,
  ],
  consumes: [
    // ACC-13: auto-invoice from a completed POS sale, idempotent per sale.
    POS_EVENTS.SALE_COMPLETED_V1,
    // ACC-15: post the inventory-side GL entry from every stock movement.
    INVENTORY_EVENTS.MOVEMENT_RECORDED_V1,
    // Phase 8 — ACC-15: post the AP entries from purchasing documents.
    PURCHASING_EVENTS.BILL_APPROVED_V1,
    PURCHASING_EVENTS.PAYMENT_RECORDED_V1,
    PURCHASING_EVENTS.SUPPLIER_RETURN_APPROVED_V1,
  ],
  providesPorts: [],
  consumesPorts: [
    {
      // ACC-14: goods-invoice issuance deducts stock inside the same transaction.
      token: 'INVENTORY_MOVEMENT_PORT',
      description: 'Issue stock for goods-invoice lines (ACC-14)',
      transactional: true,
    },
  ],
  searchContributor: false,
  dashboardWidgets: [
    {
      id: 'ar-aging',
      titleKey: 'modules.accounting.widgets.ar_aging',
      width: 2,
      height: 1,
    },
  ],
  dataRetentionDays: 365,
});
