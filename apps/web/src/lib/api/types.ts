// Typed views of the API wire format (mirrors apps/api DTOs).

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  preferredLocale: string | null;
  emailVerified: boolean;
  createdAt: string;
}

export interface MembershipOrg {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  roleId: string;
  status: 'active' | 'invited' | 'disabled';
  /** Org-level lifecycle status — pending_deletion orgs stay switchable so the owner can cancel (GDPR-2). */
  organizationStatus: 'active' | 'suspended' | 'pending_deletion';
  joinedAt: string;
  current: boolean;
}

export interface MemberResponse {
  id: string;
  userId: string;
  name: string;
  email: string;
  roleId: string;
  status: 'active' | 'invited' | 'disabled';
  joinedAt: string;
}

export interface InvitationResponse {
  id: string;
  /** Invitee display name (nullable for pre-0012 invitations). */
  name: string | null;
  email: string;
  roleId: string;
  status: 'pending' | 'accepted' | 'revoked';
  expiresAt: string;
  createdAt: string;
}

export interface RoleResponse {
  id: string;
  key: string;
  nameI18n: Record<string, string>;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  memberCount: number;
}

export interface RoleMatrix {
  systemRoles: Array<{ key: string; permissions: string[] }>;
  customRoles: Array<{
    id: string;
    key: string;
    nameI18n: Record<string, string>;
    description: string | null;
    permissions: string[];
  }>;
  platformPermissions: string[];
  permissionCatalog: string[];
}

export type EntitlementState = 'active' | 'trialing' | 'past_due' | 'none';

export interface Entitlement {
  moduleKey: string;
  state: EntitlementState;
  trialEndsAt: string | null;
  activatedAt: string | null;
}

export interface BillingResponse {
  subscription: {
    id: string;
    stripeCustomerId: string;
    status: string;
    billingCurrency: string;
    currentPeriodEnd: string | null;
  } | null;
  entitlements: Entitlement[];
}

export interface NavigationItem {
  labelKey: string;
  href: string;
  icon?: string;
  children?: Array<{ labelKey: string; href: string; icon?: string }>;
}

export interface NavigationGroup {
  moduleKey: string;
  labelKey: string;
  icon?: string;
  items: NavigationItem[];
}

export interface ModuleDefinition {
  key: string;
  nameKey: string;
  descriptionKey: string | null;
  icon: string | null;
  dependsOn: string[];
  trialDays: number;
}

export interface DashboardWidget {
  id: string;
  titleKey: string;
  width: number;
  height: number;
  icon?: string;
}

export interface DashboardWidgetGroup {
  moduleKey: string;
  labelKey: string;
  widgets: DashboardWidget[];
}

export interface SearchResultItem {
  id: string;
  title: string;
  description?: string;
  href: string;
  icon?: string;
}

export interface SearchResultGroup {
  moduleKey: string;
  labelKey: string;
  results: SearchResultItem[];
}

export interface SearchResponse {
  query: string;
  results: SearchResultGroup[];
}

export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  countryCode: string;
  timezone: string;
  baseCurrency: string;
  defaultLocale: string;
  status: string;
  deletionScheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationSettingsResponse {
  id: string;
  organizationId: string;
  locale: string;
  timezone: string;
  baseCurrency: string;
  numberPreferences: Record<string, unknown>;
  datePreferences: Record<string, unknown>;
  receiptFooter: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  correlationId: string | null;
  occurredAt: string;
}

export interface AuditLogQueryResponse {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}
