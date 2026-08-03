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

export {
  CRM_EVENTS,
  crmContactCreatedV1Schema,
  crmContactUpdatedV1Schema,
  crmDealStageChangedV1Schema,
  crmDealWonV1Schema,
  crmDealLostV1Schema,
  minorUnitsString,
  currencyCode,
  decimalString,
} from './events/index.js';
export type {
  CrmContactCreatedV1,
  CrmContactUpdatedV1,
  CrmDealStageChangedV1,
  CrmDealWonV1,
  CrmDealLostV1,
} from './events/index.js';

export type { TransactionRef, PortToken, SearchContributor, SearchResult, FxRateRead } from './ports/index.js';
export { SEARCH_CONTRIBUTORS, MEMBERSHIP_READ_PORT, ORGANIZATION_READ_PORT, FX_RATE_READ_PORT } from './ports/index.js';
export type { MembershipReadPort, OrganizationReadPort, FxRateReadPort } from './ports/index.js';
