// apps/api/src/platform/module-registry/registered-modules.ts
//
// The single source of truth for which modules are registered in this deployment.
// At boot, the ModuleRegistryService collects these descriptors, validates them,
// and mirrors them to core_module_catalog + core_permissions.
//
// @see PLAN.md §2.7 — Module registry
// @see MODULE_GUIDE.md — Module descriptor rules

import { defineModule, type ModuleDescriptor } from '@modubiz/contracts';
import { purchasingDescriptor } from '../../modules/purchasing/public/index.js';
import { accountingDescriptor } from '../../modules/accounting/public/index.js';

import { crmDescriptor } from '../../modules/crm/public/index.js';
import { inventoryDescriptor } from '../../modules/inventory/public/index.js';
import { posDescriptor } from '../../modules/pos/public/index.js';

/**
 * All registered business modules.
 * Bootstrap collects this array at startup — fail fast on any validation error.
 *
 * Each descriptor is re-validated through `defineModule()` at composition time
 * (idempotent) so a hand-edited descriptor fails fast here, and the import
 * keeps the `defineModule` anchor the module generator requires.
 */
export const REGISTERED_MODULES: ModuleDescriptor[] = [
  defineModule(crmDescriptor),
  defineModule(inventoryDescriptor),
  defineModule(posDescriptor),
  defineModule(accountingDescriptor),
  purchasingDescriptor,
];
