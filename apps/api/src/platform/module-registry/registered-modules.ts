// apps/api/src/platform/module-registry/registered-modules.ts
//
// The single source of truth for which modules are registered in this deployment.
// At boot, the ModuleRegistryService collects these descriptors, validates them,
// and mirrors them to core_module_catalog + core_permissions.
//
// @see PLAN.md §2.7 — Module registry
// @see MODULE_GUIDE.md — Module descriptor rules

import { type ModuleDescriptor } from '@modubiz/contracts';

import { crmDescriptor } from '../../modules/crm/public/index.js';
import { inventoryDescriptor } from '../../modules/inventory/public/index.js';
import { posDescriptor } from '../../modules/pos/public/index.js';

/**
 * All registered business modules.
 * Bootstrap collects this array at startup — fail fast on any validation error.
 */
export const REGISTERED_MODULES: ModuleDescriptor[] = [crmDescriptor, inventoryDescriptor, posDescriptor];
