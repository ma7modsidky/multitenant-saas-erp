// Module public barrel — imported ONLY by the composition root
// (app.module.ts and platform/module-registry/registered-modules.ts).
export { InventoryModule } from '../inventory.module.js';
export { inventoryDescriptor } from '../inventory.descriptor.js';
// Search contributor — registered by the composition root as a
// SEARCH_CONTRIBUTORS multi-provider (ARCHITECTURE.md §6).
export { InventorySearchContributor } from '../search/inventory-search.contributor.js';
