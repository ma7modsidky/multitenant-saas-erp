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
import { inventoryDescriptor } from '../../modules/inventory/public/index.js';

/**
 * All registered business modules.
 * Bootstrap collects this array at startup — fail fast on any validation error.
 */
export const REGISTERED_MODULES: ModuleDescriptor[] = [
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
  inventoryDescriptor,
];
