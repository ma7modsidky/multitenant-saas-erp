import { INVENTORY_EVENTS, defineModule, type ModuleDescriptor } from '@modubiz/contracts';

/**
 * Inventory module descriptor — the entire integration surface with the platform.
 *
 * @see MODULE_GUIDE.md §2 — Descriptor rules
 * @see PLAN.md §5 — Inventory module (full stack)
 */
export const inventoryDescriptor: ModuleDescriptor = defineModule({
  key: 'inventory',
  version: '1.0.0',
  nameKey: 'modules.inventory.name',
  descriptionKey: 'modules.inventory.description',
  icon: 'package',
  tablePrefix: 'inv_',
  dependsOn: [],
  stripePriceKey: 'price_inventory_monthly',
  trialDays: 14,
  permissions: [
    'inventory:product:read',
    'inventory:product:write',
    'inventory:stock:adjust',
    'inventory:stock:count',
    'inventory:warehouse:write',
    'inventory:transfer:execute',
  ],
  navigation: [
    {
      labelKey: 'modules.inventory.nav.products',
      href: '/m/inventory/products',
      icon: 'package',
    },
    {
      labelKey: 'modules.inventory.nav.warehouses',
      href: '/m/inventory/warehouses',
      icon: 'warehouse',
    },
    {
      labelKey: 'modules.inventory.nav.stock',
      href: '/m/inventory/stock',
      icon: 'bar-chart',
      // The stock section owns the movements / transfers / reservations
      // sub-routes — nesting them here keeps the sidebar hierarchy correct
      // (they used to float as a top-level "Reservations" item, PLT-8-era).
      children: [
        {
          labelKey: 'modules.inventory.nav.movements',
          href: '/m/inventory/stock/movements',
          icon: 'history',
        },
        {
          labelKey: 'modules.inventory.nav.transfers',
          href: '/m/inventory/stock/transfers',
          icon: 'repeat',
        },
        {
          labelKey: 'modules.inventory.nav.reservations',
          href: '/m/inventory/stock/reservations',
          icon: 'lock',
        },
      ],
    },
    {
      labelKey: 'modules.inventory.nav.stockCounts',
      href: '/m/inventory/stock-counts',
      icon: 'clipboard-list',
    },
  ],
  publishes: [
    INVENTORY_EVENTS.PRODUCT_CREATED_V1,
    INVENTORY_EVENTS.PRODUCT_ARCHIVED_V1,
    INVENTORY_EVENTS.PRODUCT_RESTORED_V1,
    INVENTORY_EVENTS.STOCK_LEVEL_CHANGED_V1,
    INVENTORY_EVENTS.STOCK_DEPLETED_V1,
    INVENTORY_EVENTS.REORDER_POINT_REACHED_V1,
  ],
  consumes: [],
  providesPorts: [
    {
      token: 'INVENTORY_STOCK_PORT',
      description: 'Stock availability, reservation, and deduction',
      transactional: true,
    },
  ],
  consumesPorts: [],
  searchContributor: true,
  dashboardWidgets: [
    {
      id: 'low-stock',
      titleKey: 'modules.inventory.widgets.low_stock',
      width: 2,
      height: 2,
    },
    {
      id: 'stock-valuation',
      titleKey: 'modules.inventory.widgets.stock_valuation',
      width: 2,
      height: 1,
    },
  ],
  dataRetentionDays: 365,
});
