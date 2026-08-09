import { INVENTORY_STOCK_PORT, POS_EVENTS, defineModule, type ModuleDescriptor } from '@modubiz/contracts';

/**
 * POS module descriptor — the entire integration surface with the platform.
 *
 * POS consumes the inventory stock port (Level 3, transactional) so checkout
 * deducts stock in the SAME transaction as the sale (POS-15), and depends on
 * the inventory module being registered.
 *
 * @see MODULE_GUIDE.md §2 — Descriptor rules
 * @see PLAN.md §6 — POS module (full stack)
 */
export const posDescriptor: ModuleDescriptor = defineModule({
  key: 'pos',
  version: '1.0.0',
  nameKey: 'modules.pos.name',
  descriptionKey: 'modules.pos.description',
  icon: 'pos',
  tablePrefix: 'pos_',
  dependsOn: ['inventory'],
  stripePriceKey: 'price_pos_monthly',
  trialDays: 14,
  permissions: [
    'pos:register:manage',
    'pos:shift:open',
    'pos:shift:close',
    'pos:sale:create',
    'pos:refund:process',
    'pos:report:view',
  ],
  navigation: [
    {
      labelKey: 'modules.pos.nav.register',
      href: '/m/pos',
      icon: 'pos',
    },
    {
      labelKey: 'modules.pos.nav.shifts',
      href: '/m/pos/shifts',
      icon: 'clock',
    },
    {
      labelKey: 'modules.pos.nav.reports',
      href: '/m/pos/reports',
      icon: 'bar-chart',
    },
  ],
  publishes: [
    POS_EVENTS.SALE_COMPLETED_V1,
    POS_EVENTS.SALE_REFUNDED_V1,
    POS_EVENTS.SHIFT_OPENED_V1,
    POS_EVENTS.SHIFT_CLOSED_V1,
  ],
  consumes: [],
  providesPorts: [],
  consumesPorts: [
    {
      token: 'INVENTORY_STOCK_PORT',
      description: 'Stock deduction inside the checkout transaction (POS-15)',
      transactional: true,
    },
  ],
  searchContributor: false,
  dashboardWidgets: [],
  dataRetentionDays: 365,
});
