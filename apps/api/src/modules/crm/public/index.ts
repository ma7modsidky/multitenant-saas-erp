// Module public barrel — imported ONLY by the composition root
// (app.module.ts and platform/module-registry/registered-modules.ts).
export { CrmModule } from '../crm.module.js';
export { crmDescriptor } from '../crm.descriptor.js';
// Search contributor — registered by the composition root as a
// SEARCH_CONTRIBUTORS multi-provider (ARCHITECTURE.md §6).
export { CrmSearchContributor } from '../search/crm-search.contributor.js';
