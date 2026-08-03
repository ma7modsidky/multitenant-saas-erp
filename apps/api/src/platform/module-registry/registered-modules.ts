// apps/api/src/platform/module-registry/registered-modules.ts
//
// The single source of truth for which modules are registered in this deployment.
// At boot, the ModuleRegistryService collects these descriptors, validates them,
// and mirrors them to core_module_catalog + core_permissions.
//
// @see PLAN.md §2.7 — Module registry
// @see MODULE_GUIDE.md — Module descriptor rules

import { defineModule, type ModuleDescriptor } from '@modubiz/contracts';

import { crmDescriptor } from '../../modules/crm/public/index.js';

/**
 * All registered business modules.
 * Bootstrap collects this array at startup — fail fast on any validation error.
 */
export const REGISTERED_MODULES: ModuleDescriptor[] = [
  defineModule({
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
      },
    ],
    publishes: [
      'inventory.product.created.v1',
      'inventory.product.archived.v1',
      'inventory.stock.level_changed.v1',
      'inventory.stock.depleted.v1',
      'inventory.reorder_point.reached.v1',
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
      { id: 'low-stock', titleKey: 'modules.inventory.widgets.low_stock', width: 2, height: 2 },
      { id: 'stock-valuation', titleKey: 'modules.inventory.widgets.stock_valuation', width: 2, height: 1 },
    ],
    dataRetentionDays: 365,
  }),

  defineModule({
    key: 'pos',
    version: '1.0.0',
    nameKey: 'modules.pos.name',
    descriptionKey: 'modules.pos.description',
    icon: 'credit-card',
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
        href: '/m/pos/register',
        icon: 'credit-card',
      },
      {
        labelKey: 'modules.pos.nav.shifts',
        href: '/m/pos/shifts',
        icon: 'clock',
      },
      {
        labelKey: 'modules.pos.nav.reports',
        href: '/m/pos/reports',
        icon: 'file-text',
      },
    ],
    publishes: ['pos.sale.completed.v1', 'pos.sale.refunded.v1', 'pos.shift.opened.v1', 'pos.shift.closed.v1'],
    consumes: ['inventory.stock.depleted.v1'],
    providesPorts: [],
    consumesPorts: [
      {
        token: 'INVENTORY_STOCK_PORT',
        description: 'Stock deduction at checkout',
        transactional: true,
      },
    ],
    searchContributor: false,
    dashboardWidgets: [
      { id: 'daily-sales', titleKey: 'modules.pos.widgets.daily_sales', width: 2, height: 1 },
      { id: 'open-shifts', titleKey: 'modules.pos.widgets.open_shifts', width: 1, height: 1 },
    ],
    dataRetentionDays: 365,
  }),
  crmDescriptor,
];
