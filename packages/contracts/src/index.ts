export { defineModule, validateDescriptors, MODULE_KEYS, DESCRIPTOR_ERROR } from './module/index.js';
export type {
  ModuleDescriptor,
  ModuleKey,
  PermissionKey,
  EventName,
  NavigationItem,
  DashboardWidget,
  PortDeclaration,
  DescriptorValidationError,
  DescriptorErrorCode,
} from './module/index.js';

export { ALL_PERMISSIONS } from './permissions/index.js';
export type { Permission } from './permissions/index.js';

export type { TransactionRef, PortToken, SearchContributor, SearchResult } from './ports/index.js';
export { SEARCH_CONTRIBUTORS } from './ports/index.js';
