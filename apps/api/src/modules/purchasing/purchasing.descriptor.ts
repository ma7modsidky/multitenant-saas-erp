import { INVENTORY_MOVEMENT_PORT, PURCHASING_EVENTS, defineModule, type ModuleDescriptor } from '@modubiz/contracts';

/**
 * Purchasing module descriptor — the entire integration surface with the platform.
 *
 * The complete purchase-to-pay cycle: supplier directory with an append-only
 * vendor ledger (accounts payable), purchase orders, goods-received notes that
 * raise stock atomically through Inventory's movement port, purchase bills
 * with three-way matching, supplier payments, and supplier returns / debit
 * notes. Accounting consumes the published bill/payment/return events to post
 * AP journal entries idempotently (ACC-15).
 *
 * @see MODULE_GUIDE.md §2 — Descriptor rules
 * @see PLAN.md §8 — Purchasing & Suppliers module (full stack)
 */
export const purchasingDescriptor: ModuleDescriptor = defineModule({
  key: 'purchasing',
  version: '1.0.0',
  nameKey: 'modules.purchasing.name',
  descriptionKey: 'modules.purchasing.description',
  icon: 'purchasing',
  tablePrefix: 'pur_',
  // PUR-4/PUR-9/PUR-11: GRN receiving, bill cost variance, and supplier
  // returns move stock through Inventory's Level 3 movement port — inventory
  // is a hard dependency.
  dependsOn: ['inventory'],
  stripePriceKey: 'price_purchasing_monthly',
  trialDays: 14,
  permissions: [
    'purchasing:supplier:read',
    'purchasing:supplier:write',
    'purchasing:requisition:write',
    'purchasing:po:write',
    'purchasing:grn:receive',
    'purchasing:bill:approve',
    'purchasing:payment:record',
    'purchasing:return:create',
    'purchasing:report:view',
  ],
  navigation: [
    {
      labelKey: 'modules.purchasing.nav.suppliers',
      href: '/m/purchasing/suppliers',
      icon: 'users',
    },
    {
      labelKey: 'modules.purchasing.nav.purchaseOrders',
      href: '/m/purchasing/purchase-orders',
      icon: 'file-text',
    },
    {
      labelKey: 'modules.purchasing.nav.receiving',
      href: '/m/purchasing/receiving',
      icon: 'package-check',
    },
    {
      labelKey: 'modules.purchasing.nav.bills',
      href: '/m/purchasing/bills',
      icon: 'receipt',
    },
    {
      labelKey: 'modules.purchasing.nav.payments',
      href: '/m/purchasing/payments',
      icon: 'wallet',
    },
    {
      labelKey: 'modules.purchasing.nav.returns',
      href: '/m/purchasing/returns',
      icon: 'undo',
    },
    {
      labelKey: 'modules.purchasing.nav.vendorBalances',
      href: '/m/purchasing/vendor-balances',
      icon: 'bar-chart',
    },
  ],
  publishes: [
    PURCHASING_EVENTS.SUPPLIER_CREATED_V1,
    PURCHASING_EVENTS.PO_APPROVED_V1,
    PURCHASING_EVENTS.GRN_RECEIVED_V1,
    PURCHASING_EVENTS.BILL_APPROVED_V1,
    PURCHASING_EVENTS.PAYMENT_RECORDED_V1,
    PURCHASING_EVENTS.SUPPLIER_RETURN_APPROVED_V1,
  ],
  consumes: [],
  providesPorts: [],
  consumesPorts: [
    {
      // PUR-4/PUR-9/PUR-11: GRN receiving, bill cost variance, and supplier
      // returns move stock inside the SAME transaction as the purchasing
      // document.
      token: INVENTORY_MOVEMENT_PORT,
      description: 'Receive stock on GRN, return stock to supplier, adjust cost on bill variance',
      transactional: true,
    },
  ],
  searchContributor: true,
  dashboardWidgets: [
    {
      id: 'vendor-balance',
      titleKey: 'modules.purchasing.widgets.vendor_balance',
      width: 2,
      height: 1,
    },
  ],
  dataRetentionDays: 365,
});
