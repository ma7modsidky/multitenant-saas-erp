// Typed resource functions for the authenticated API.
// One function per endpoint the web app consumes.

import type {
  AuditLogQueryResponse,
  BillingResponse,
  DashboardWidgetGroup,
  InvitationResponse,
  MemberResponse,
  MembershipOrg,
  ModuleDefinition,
  NavigationGroup,
  OrganizationResponse,
  OrganizationSettingsResponse,
  RoleMatrix,
  RoleResponse,
  SearchResponse,
} from './types';

import { ApiError, apiFetch } from './index';

// ─── Organizations ─────────────────────────────────────────────────────────

export function createOrganization(input: {
  name: string;
  slug: string;
  countryCode: string;
  timezone?: string;
  baseCurrency: string;
  defaultLocale?: string;
}): Promise<OrganizationResponse> {
  return apiFetch<OrganizationResponse>('/v1/organizations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getMyOrganizations(): Promise<MembershipOrg[]> {
  return apiFetch<MembershipOrg[]>('/v1/users/me/organizations');
}

export function getActiveOrganization(): Promise<{
  data: OrganizationResponse;
  settings: OrganizationSettingsResponse | null;
}> {
  return apiFetch<{ data: OrganizationResponse; settings: OrganizationSettingsResponse | null }>(
    '/v1/organizations/me',
    {},
    { envelope: true },
  );
}

export function getOrganization(orgId: string): Promise<{
  data: OrganizationResponse;
  settings: OrganizationSettingsResponse | null;
}> {
  return apiFetch<{ data: OrganizationResponse; settings: OrganizationSettingsResponse | null }>(
    `/v1/organizations/${orgId}`,
    {},
    { envelope: true },
  );
}

export function updateOrganization(
  orgId: string,
  patch: Partial<Pick<OrganizationResponse, 'name' | 'countryCode' | 'timezone' | 'baseCurrency' | 'defaultLocale'>>,
): Promise<OrganizationResponse> {
  return apiFetch<OrganizationResponse>(`/v1/organizations/${orgId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function updateOrganizationSettings(
  orgId: string,
  patch: {
    locale?: string;
    timezone?: string;
    baseCurrency?: string;
    receiptFooter?: string | null;
  },
): Promise<OrganizationSettingsResponse> {
  return apiFetch<OrganizationSettingsResponse>(`/v1/organizations/${orgId}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteOrganization(orgId: string): Promise<{ deletionScheduledAt: string; message: string }> {
  return apiFetch<{ deletionScheduledAt: string; message: string }>(`/v1/organizations/${orgId}`, { method: 'DELETE' });
}

export function cancelOrganizationDeletion(orgId: string): Promise<OrganizationResponse> {
  return apiFetch<OrganizationResponse>(`/v1/organizations/${orgId}/cancel-deletion`, { method: 'POST' });
}

// ─── Memberships ───────────────────────────────────────────────────────────

export function getMembers(orgId: string): Promise<MemberResponse[]> {
  return apiFetch<MemberResponse[]>(`/v1/organizations/${orgId}/members`);
}

export function getInvitations(orgId: string): Promise<InvitationResponse[]> {
  return apiFetch<InvitationResponse[]>(`/v1/organizations/${orgId}/invitations`);
}

export function inviteUser(
  orgId: string,
  input: { name: string; email: string; roleId: string },
): Promise<{ invitationId: string }> {
  return apiFetch<{ invitationId: string }>(`/v1/organizations/${orgId}/invitations`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function acceptInvitation(id: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/invitations/${id}/accept`, { method: 'POST' });
}

export function revokeInvitation(orgId: string, invitationId: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/organizations/${orgId}/invitations/${invitationId}/revoke`, {
    method: 'POST',
  });
}

export function updateMemberRole(id: string, roleId: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/memberships/${id}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ roleId }),
  });
}

export function removeMember(id: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/memberships/${id}`, { method: 'DELETE' });
}

// ─── Audit log ──────────────────────────────────────────────────────────────

export interface AuditLogQueryParams {
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export function getAuditLog(orgId: string, params: AuditLogQueryParams = {}): Promise<AuditLogQueryResponse> {
  const query = new URLSearchParams();
  if (params.actorUserId !== undefined) query.set('actorUserId', params.actorUserId);
  if (params.entityType !== undefined) query.set('entityType', params.entityType);
  if (params.entityId !== undefined) query.set('entityId', params.entityId);
  if (params.action !== undefined) query.set('action', params.action);
  if (params.fromDate !== undefined) query.set('fromDate', params.fromDate);
  if (params.toDate !== undefined) query.set('toDate', params.toDate);
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<AuditLogQueryResponse>(`/v1/organizations/${orgId}/audit-log${qs ? `?${qs}` : ''}`);
}

// ─── Roles ─────────────────────────────────────────────────────────────────

export function getRoles(orgId: string): Promise<RoleResponse[]> {
  return apiFetch<RoleResponse[]>(`/v1/organizations/${orgId}/roles`);
}

export function getRoleMatrix(orgId: string): Promise<RoleMatrix> {
  return apiFetch<RoleMatrix>(`/v1/organizations/${orgId}/roles/matrix`);
}

export function createRole(
  orgId: string,
  input: { key: string; nameI18n?: Record<string, string>; description?: string; permissionKeys?: string[] },
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/v1/organizations/${orgId}/roles`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateRole(
  id: string,
  input: { nameI18n?: Record<string, string>; description?: string | null; permissionKeys?: string[] },
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/roles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteRole(id: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/roles/${id}`, { method: 'DELETE' });
}

// ─── Billing ───────────────────────────────────────────────────────────────

export function getBilling(orgId: string): Promise<BillingResponse> {
  return apiFetch<BillingResponse>(`/v1/organizations/${orgId}/billing`);
}

export function enableModuleTrial(orgId: string, moduleKey: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/organizations/${orgId}/billing/trial`, {
    method: 'POST',
    body: JSON.stringify({ moduleKey }),
  });
}

export function disableBillingModule(orgId: string, moduleKey: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/organizations/${orgId}/billing/disable`, {
    method: 'POST',
    body: JSON.stringify({ moduleKey }),
  });
}

// ─── Module registry ───────────────────────────────────────────────────────

export function getModuleCatalog(): Promise<ModuleDefinition[]> {
  return apiFetch<ModuleDefinition[]>('/v1/modules');
}

export function getNavigation(): Promise<NavigationGroup[]> {
  return apiFetch<NavigationGroup[]>('/v1/me/navigation');
}

export function getDashboardWidgets(): Promise<DashboardWidgetGroup[]> {
  return apiFetch<DashboardWidgetGroup[]>('/v1/me/dashboard/widgets');
}

/** Federated search across all entitled modules' search contributors. */
export function searchFederated(query: string): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q: query }).toString();
  return apiFetch<SearchResponse>(`/v1/search?${qs}`);
}

export function enableModule(orgId: string, moduleKey: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/organizations/${orgId}/modules/enable`, {
    method: 'POST',
    body: JSON.stringify({ moduleKey }),
  });
}

export function disableModule(orgId: string, moduleKey: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/organizations/${orgId}/modules/disable`, {
    method: 'POST',
    body: JSON.stringify({ moduleKey }),
  });
}

// ─── Currencies & FX rates (reference data) ─────────────────────────────────

export interface Currency {
  code: string;
  exponent: number;
  symbol: string;
  name: string;
}

export function getCurrencies(): Promise<Currency[]> {
  return apiFetch<Currency[]>('/v1/currencies');
}

export interface FxRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  validOn: string;
  source: string;
}

/**
 * Latest FX rate for a pair. Returns null when no snapshot exists (404) —
 * mirroring the read port the CRM controller uses (undefined → no rate), so
 * the deal-form preview can show an "unavailable" state instead of failing.
 */
export function getFxRate(baseCurrency: string, quoteCurrency: string): Promise<FxRate | null> {
  return apiFetch<FxRate>(`/v1/fx-rates/${baseCurrency}/${quoteCurrency}`).catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  });
}

// ─── CRM ───────────────────────────────────────────────────────────────────

export interface CrmContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  companyId: string | null;
  ownerUserId: string | null;
  preferredLocale: string | null;
  preferredCurrency: string | null;
  /** ISO timestamps (list rows; detail view always has them). */
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CrmDeal {
  id: string;
  title: string;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  companyId: string | null;
  /** Resolved display names from the list query (may be absent on detail). */
  contactName?: string | null;
  companyName?: string | null;
  value: { amountMinor: string; currency: string };
  /** Org-base amount (list rows; null when the value currency = org base). */
  baseAmountMinor?: string | null;
  status: 'open' | 'won' | 'lost';
  ownerUserId: string | null;
  /** ISO timestamps (list + detail rows). */
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CrmCompany {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  address: Record<string, unknown>;
  ownerUserId: string | null;
  /** ISO timestamps (list rows; detail view always has them). */
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CrmActivity {
  id: string;
  type: 'call' | 'meeting' | 'task' | 'email';
  subject: string;
  dueAt: string | null;
  completedAt: string | null;
  relatedType: string | null;
  relatedId: string | null;
  assignedToUserId: string | null;
  /** Resolved related-entity display name (list response, optional). */
  relatedName?: string | null;
  /** Deal-related activities: the deal's current stage (list response). */
  dealStageId?: string | null;
  dealStageNameI18n?: Record<string, string> | null;
  /** ISO timestamps (list rows; detail view always has them). */
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** Activity detail — list fields + timestamps + audit stamps. */
export interface CrmActivityDetail extends CrmActivity {
  /** Who created / last edited (names resolved client-side). */
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CrmPipeline {
  id: string;
  nameI18n: Record<string, string>;
  stages: Array<{
    id: string;
    nameI18n: Record<string, string>;
    position: number;
    probability: number;
    isWon: boolean;
    isLost: boolean;
  }>;
}

/** Contact detail — list fields + timestamps + audit stamps. */
export interface CrmContactDetail extends CrmContact {
  /** Who created / last edited (names resolved client-side). */
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Company detail — list fields + timestamps + audit stamps. */
export interface CrmCompanyDetail extends CrmCompany {
  /** Who created / last edited (names resolved client-side). */
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** One append-only stage-history entry (CRM-6). */
export interface CrmStageHistoryEntry {
  id: string;
  fromStageId: string | null;
  toStageId: string;
  movedAt: string | null;
  movedBy: string;
  durationSeconds: number;
}

/** Deal detail — list fields + FX snapshot + closed info + stage history. */
export interface CrmDealDetail extends CrmDeal {
  exchangeRate: number | null;
  baseAmountMinor: string | null;
  expectedCloseDate: string | null;
  closedAt: string | null;
  lostReasonCode: string | null;
  /** Who created / last edited the deal (names resolved client-side). */
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  stageHistory: CrmStageHistoryEntry[];
}

/** Default page size for CRM list endpoints (matches the API default). */
export const CRM_PAGE_SIZE = 12;

export interface CrmListParams {
  search?: string;
  /** Restrict deals to one pipeline stage (board columns). */
  stageId?: string;
  /** Restrict deals by status (table view). */
  status?: 'open' | 'won' | 'lost';
  /** Inclusive lower bound on updated_at (ISO date YYYY-MM-DD). */
  fromDate?: string;
  /** Inclusive upper bound on updated_at (ISO date YYYY-MM-DD). */
  toDate?: string;
  /**
   * Sort key (table views). Each entity allow-lists its own keys server-side
   * (deals: updatedAt/createdAt/title/value; contacts: + name/email; etc.),
   * so this is a plain string that the table components constrain.
   */
  sortBy?: string;
  /** Sort direction (table views). Default `desc`. */
  sortDir?: 'asc' | 'desc';
  /** Restrict activities to those assigned to this user id. */
  assigneeUserId?: string;
  /** Restrict activities to those with no assignee. */
  unassigned?: boolean;
  /** Restrict activities by completion: true = completed, false = open. */
  completed?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CrmContactListParams extends CrmListParams {
  companyId?: string;
}

/** Paginated CRM list response — `items` plus total/page/pageSize. */
export interface CrmPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function toQueryString(params: CrmListParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.stageId) query.set('stageId', params.stageId);
  if (params.status) query.set('status', params.status);
  if (params.fromDate) query.set('fromDate', params.fromDate);
  if (params.toDate) query.set('toDate', params.toDate);
  if (params.sortBy) query.set('sortBy', params.sortBy);
  if (params.sortDir) query.set('sortDir', params.sortDir);
  if (params.assigneeUserId) query.set('assigneeUserId', params.assigneeUserId);
  if (params.unassigned) query.set('unassigned', 'true');
  if (params.completed !== undefined) query.set('completed', String(params.completed));
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined && params.pageSize !== CRM_PAGE_SIZE)
    query.set('pageSize', String(params.pageSize));
  return query.toString();
}

export function getCrmContacts(params: CrmContactListParams = {}): Promise<CrmPage<CrmContact>> {
  const query = new URLSearchParams(toQueryString(params));
  if (params.companyId) query.set('companyId', params.companyId);
  const qs = query.toString();
  return apiFetch<CrmPage<CrmContact>>(`/v1/crm/contacts${qs ? `?${qs}` : ''}`);
}

export function getCrmCompanies(params: CrmListParams = {}): Promise<CrmPage<CrmCompany>> {
  const qs = toQueryString(params);
  return apiFetch<CrmPage<CrmCompany>>(`/v1/crm/companies${qs ? `?${qs}` : ''}`);
}

/** Deals page — includes the exact org-base value of the matching set. */
export interface CrmDealsPage extends CrmPage<CrmDeal> {
  /** Sum of the matching deals in org-base minor units (server-side, exact). */
  totalValueBaseMinor: string;
}

export function getCrmDeals(params: CrmListParams = {}): Promise<CrmDealsPage> {
  const qs = toQueryString(params);
  return apiFetch<CrmDealsPage>(`/v1/crm/deals${qs ? `?${qs}` : ''}`);
}

export function getCrmActivities(params: CrmListParams = {}): Promise<CrmPage<CrmActivity>> {
  const qs = toQueryString(params);
  return apiFetch<CrmPage<CrmActivity>>(`/v1/crm/activities${qs ? `?${qs}` : ''}`);
}

export function getCrmPipeline(): Promise<CrmPipeline | null> {
  return apiFetch<CrmPipeline | null>('/v1/crm/pipelines/default');
}

export function getCrmContact(id: string): Promise<CrmContactDetail> {
  return apiFetch<CrmContactDetail>(`/v1/crm/contacts/${id}`);
}

export function getCrmCompany(id: string): Promise<CrmCompanyDetail> {
  return apiFetch<CrmCompanyDetail>(`/v1/crm/companies/${id}`);
}

export function getCrmDeal(id: string): Promise<CrmDealDetail> {
  return apiFetch<CrmDealDetail>(`/v1/crm/deals/${id}`);
}

export function getCrmActivity(id: string): Promise<CrmActivityDetail> {
  return apiFetch<CrmActivityDetail>(`/v1/crm/activities/${id}`);
}

export function createCrmCompany(input: Omit<CrmCompany, 'id' | 'ownerUserId'>): Promise<CrmCompany> {
  return apiFetch<CrmCompany>('/v1/crm/companies', { method: 'POST', body: JSON.stringify(input) });
}

export function createCrmContact(input: {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  secondaryPhone?: string | null;
  companyId?: string | null;
  preferredLocale?: string | null;
  preferredCurrency?: string | null;
}): Promise<CrmContact> {
  return apiFetch<CrmContact>('/v1/crm/contacts', { method: 'POST', body: JSON.stringify(input) });
}

export function updateCrmContact(id: string, input: Partial<Omit<CrmContact, 'id'>>): Promise<CrmContact> {
  return apiFetch<CrmContact>(`/v1/crm/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function updateCrmCompany(
  id: string,
  input: Partial<Omit<CrmCompany, 'id' | 'ownerUserId'>>,
): Promise<CrmCompany> {
  return apiFetch<CrmCompany>(`/v1/crm/companies/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function mergeCrmContacts(sourceContactId: string, targetContactId: string): Promise<CrmContact> {
  return apiFetch<CrmContact>('/v1/crm/contacts/merge', {
    method: 'POST',
    body: JSON.stringify({ sourceContactId, targetContactId }),
  });
}

export function createCrmDeal(input: {
  title: string;
  contactId?: string | null;
  companyId?: string | null;
  value: { amountMinor: string; currency: string };
}): Promise<CrmDeal> {
  return apiFetch<CrmDeal>('/v1/crm/deals', { method: 'POST', body: JSON.stringify(input) });
}

export function moveCrmDeal(dealId: string, toStageId: string, lostReasonCode?: string): Promise<CrmDeal> {
  return apiFetch<CrmDeal>(`/v1/crm/deals/${dealId}/move-stage`, {
    method: 'POST',
    body: JSON.stringify({ toStageId, ...(lostReasonCode ? { lostReasonCode } : {}) }),
  });
}

export function createCrmActivity(input: {
  type: 'call' | 'meeting' | 'task' | 'email';
  subject: string;
  dueAt?: string | null;
  relatedType?: 'contact' | 'company' | 'deal' | null;
  relatedId?: string | null;
}): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/v1/crm/activities', { method: 'POST', body: JSON.stringify(input) });
}

export function completeCrmActivity(id: string): Promise<CrmActivity> {
  return apiFetch<CrmActivity>(`/v1/crm/activities/${id}/complete`, { method: 'POST' });
}

export interface CrmActivityUpdate {
  type?: 'call' | 'meeting' | 'task' | 'email';
  subject?: string;
  dueAt?: string | null;
  /** Assignee user id, or null to unassign (CRM-14: active members only). */
  assignedToUserId?: string | null;
}

export function updateCrmActivity(id: string, input: CrmActivityUpdate): Promise<CrmActivity> {
  return apiFetch<CrmActivity>(`/v1/crm/activities/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

// ─── CRM Notes ───────────────────────────────────────────────────────────────

export interface CrmNote {
  id: string;
  body: string;
  relatedType: string;
  relatedId: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  createdByName: string | null;
}

export function getCrmNotes(relatedType: string, relatedId: string): Promise<{ items: CrmNote[] }> {
  return apiFetch<{ items: CrmNote[] }>(`/v1/crm/notes/${relatedType}/${relatedId}`);
}

export function createCrmNote(input: {
  body: string;
  relatedType: 'contact' | 'company' | 'deal' | 'activity';
  relatedId: string;
}): Promise<CrmNote> {
  return apiFetch<CrmNote>('/v1/crm/notes', { method: 'POST', body: JSON.stringify(input) });
}

// ─── Inventory ───────────────────────────────────────────────────────────────

/** Product row — product + its first active variant (list response). */
export interface InventoryProduct {
  id: string;
  nameI18n: Record<string, string>;
  isActive: boolean;
  variantId: string | null;
  sku: string | null;
  price: { amountMinor: string; currency: string } | null;
  reorderPoint: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Number of non-deleted variants (INV-11) — the "Variants" table column. */
  variantCount: number;
  /**
   * Every variant of the product (active + archived, INV-11), primary first —
   * the grouped products table renders these rows under a product header.
   */
  variants: Array<{
    id: string;
    sku: string;
    price: { amountMinor: string; currency: string };
    reorderPoint: string;
    isActive: boolean;
  }>;
}

/** One sellable variant in the picker list (receive/adjust/transfer/count forms). */
export interface InventoryVariantOption {
  variantId: string;
  productId: string;
  sku: string;
  nameI18n: Record<string, string>;
}

/** Filters for the variants picker list. */
export interface InventoryVariantParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

export function getInventoryVariants(
  params: InventoryVariantParams = {},
): Promise<InventoryPage<InventoryVariantOption>> {
  const qs = inventoryQueryString(params);
  return apiFetch<InventoryPage<InventoryVariantOption>>(`/v1/inventory/variants${qs ? `?${qs}` : ''}`);
}

/** Stock projection row with availability (INV-5). */
export interface InventoryStockLevel {
  variantId: string;
  sku: string;
  /** Owning product — the stock page groups variant rows under it. */
  productId: string;
  nameI18n: Record<string, string>;
  /** Null only for a never-received variant when the org has no warehouse yet. */
  warehouseId: string | null;
  warehouseName: string | null;
  quantityOnHand: string;
  quantityReserved: string;
  quantityAvailable: string;
  reorderPoint: string;
  /** INV-2 — last movement id that updated this projection. */
  lastMovementId: string | null;
  /** Variant unit cost (stock valuation widget / reports). */
  unitCost: { amountMinor: string; currency: string } | null;
}

/** One append-only stock movement row (INV-1 ledger view). */
export interface InventoryMovement {
  id: string;
  type:
    'receipt' | 'sale' | 'return' | 'transfer_in' | 'transfer_out' | 'adjustment' | 'count_correction' | 'write_off';
  /** Owning variant — transfers pair movements by variant for repeat. */
  variantId: string;
  sku: string;
  nameI18n: Record<string, string>;
  warehouseId: string | null;
  warehouseName: string | null;
  /** Signed quantity in UoM units (decimal string, INV-15). */
  quantity: string;
  unitCost: { amountMinor: string; currency: string } | null;
  referenceType: string;
  referenceId: string;
  reasonCode: string | null;
  occurredAt: string;
  createdBy: string | null;
}

export interface InventoryWarehouse {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface InventoryStockCountLine {
  id: string;
  variantId: string;
  expectedQuantity: string;
  countedQuantity: string;
  variance: string;
}

export interface InventoryStockCount {
  id: string;
  warehouseId: string;
  status: 'draft' | 'applied';
  countedAt: string | null;
  countedBy: string | null;
  notes: string | null;
  lines: InventoryStockCountLine[];
  createdAt: string;
  updatedAt: string;
}

/** Filters for the products list (search / active-archived status). */
export interface InventoryProductParams {
  search?: string;
  /** `active` = has a sellable variant; `archived` = every variant archived. */
  status?: 'active' | 'archived';
  page?: number;
  pageSize?: number;
}

export function getInventoryProducts(params: InventoryProductParams = {}): Promise<InventoryPage<InventoryProduct>> {
  const qs = inventoryQueryString(params);
  return apiFetch<InventoryPage<InventoryProduct>>(`/v1/inventory/products${qs ? `?${qs}` : ''}`);
}

export function createInventoryProduct(input: {
  nameI18n: Record<string, string>;
  sku: string;
  barcode?: string | null;
  price: { amountMinor: string; currency: string };
  cost: { amountMinor: string; currency: string };
  reorderPoint: string;
  reorderQuantity: string;
}): Promise<{ productId: string; variantId: string }> {
  return apiFetch<{ productId: string; variantId: string }>('/v1/inventory/products', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Renames the product (catalog metadata — name_i18n). */
export function updateInventoryProduct(
  id: string,
  input: { nameI18n?: Record<string, string>; descriptionI18n?: Record<string, string> },
): Promise<{ productId: string; updatedAt: string }> {
  return apiFetch<{ productId: string; updatedAt: string }>(`/v1/inventory/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function archiveInventoryProduct(id: string): Promise<{ archivedAt: string }> {
  return apiFetch<{ archivedAt: string }>(`/v1/inventory/products/${id}/archive`, { method: 'POST' });
}

export function unarchiveInventoryProduct(id: string): Promise<{ restoredAt: string }> {
  return apiFetch<{ restoredAt: string }>(`/v1/inventory/products/${id}/unarchive`, { method: 'POST' });
}

/** One variant inside the product detail response. */
export interface InventoryVariant {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  price: { amountMinor: string; currency: string };
  cost: { amountMinor: string; currency: string };
  reorderPoint: string;
  reorderQuantity: string;
  isActive: boolean;
  /** Actor stamps — who created / last edited this variant (audit trail). */
  createdByUserId: string | null;
  updatedByUserId: string | null;
  /** Per-warehouse stock projection rows for this variant. */
  stock: InventoryStockLevel[];
}

/** Product detail — product + variants + per-warehouse stock + ledger history. */
export interface InventoryProductDetail {
  product: {
    id: string;
    nameI18n: Record<string, string>;
    descriptionI18n: Record<string, string>;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    /** Actor stamps — who created / last edited this product (audit trail). */
    createdByUserId: string | null;
    updatedByUserId: string | null;
  };
  variants: InventoryVariant[];
  movements: InventoryMovement[];
}

/** One reservation row (INV-7/8 list view). */
export interface InventoryReservation {
  id: string;
  variantId: string;
  sku: string;
  nameI18n: Record<string, string>;
  warehouseId: string;
  warehouseName: string;
  quantity: string;
  state: 'held' | 'committed' | 'released' | 'expired';
  expiresAt: string;
  referenceType: string;
  referenceId: string;
  createdAt: string;
}

/** Stock-count detail — count + warehouse name + enriched lines. */
export interface InventoryStockCountDetail {
  id: string;
  warehouseId: string;
  warehouseName: string;
  status: 'draft' | 'applied';
  countedAt: string | null;
  countedBy: string | null;
  notes: string | null;
  lines: Array<
    InventoryStockCountLine & {
      sku: string;
      nameI18n: Record<string, string>;
    }
  >;
  createdAt: string;
  updatedAt: string;
}

export function getInventoryProduct(id: string): Promise<InventoryProductDetail> {
  return apiFetch<InventoryProductDetail>(`/v1/inventory/products/${id}`);
}

export function createInventoryVariant(
  productId: string,
  input: {
    sku: string;
    barcode?: string | null;
    price: { amountMinor: string; currency: string };
    cost: { amountMinor: string; currency: string };
    reorderPoint: string;
    reorderQuantity: string;
  },
): Promise<{ variantId: string }> {
  return apiFetch<{ variantId: string }>(`/v1/inventory/products/${productId}/variants`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Edits a variant's sellable fields (INV-10 SKU uniqueness is server-enforced). */
export function updateInventoryVariant(
  id: string,
  input: {
    sku?: string;
    barcode?: string | null;
    price?: { amountMinor: string; currency: string };
    cost?: { amountMinor: string; currency: string };
    reorderPoint?: string;
    reorderQuantity?: string;
  },
): Promise<{ variantId: string; updatedAt: string }> {
  return apiFetch<{ variantId: string; updatedAt: string }>(`/v1/inventory/variants/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function archiveInventoryVariant(id: string): Promise<{ archivedAt: string }> {
  return apiFetch<{ archivedAt: string }>(`/v1/inventory/variants/${id}/archive`, { method: 'POST' });
}

export function unarchiveInventoryVariant(id: string): Promise<{ restoredAt: string }> {
  return apiFetch<{ restoredAt: string }>(`/v1/inventory/variants/${id}/unarchive`, { method: 'POST' });
}

export function createInventoryWarehouse(input: {
  name: string;
  code: string;
  isDefault?: boolean;
}): Promise<InventoryWarehouse> {
  return apiFetch<InventoryWarehouse>('/v1/inventory/warehouses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Paginated inventory list response — `items` plus total/page/pageSize. */
export interface InventoryPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Rows per page for inventory list views (matches the backend default clamp). */
export const INVENTORY_PAGE_SIZE = 12;

/** Filters for the stock-levels list (INV-5/13): search / warehouse / low-stock. */
export interface InventoryStockParams {
  search?: string;
  warehouseId?: string;
  /** Restrict to rows at or below their reorder point. */
  lowStock?: boolean;
  page?: number;
  pageSize?: number;
}

/** Filters for the movements ledger (INV-1): search / type / date range. */
export interface InventoryMovementParams {
  search?: string;
  type?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

/** Filters for the reservations list (INV-7/8): status + pagination. */
export interface InventoryReservationParams {
  status?: 'held' | 'committed' | 'released' | 'expired';
  page?: number;
  pageSize?: number;
}

/** Serialize inventory list params to a query string (absent/empty/false omitted). */
function inventoryQueryString(params: object): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== false) query.set(key, String(value));
  }
  return query.toString();
}

export function getInventoryReservations(
  params: InventoryReservationParams = {},
): Promise<InventoryPage<InventoryReservation>> {
  const qs = inventoryQueryString(params);
  return apiFetch<InventoryPage<InventoryReservation>>(`/v1/inventory/reservations${qs ? `?${qs}` : ''}`);
}

export function getInventoryStockCount(id: string): Promise<InventoryStockCountDetail> {
  return apiFetch<InventoryStockCountDetail>(`/v1/inventory/stock-counts/${id}`);
}

export function getInventoryWarehouses(): Promise<{ items: InventoryWarehouse[] }> {
  return apiFetch<{ items: InventoryWarehouse[] }>('/v1/inventory/warehouses');
}

export function getInventoryStock(params: InventoryStockParams = {}): Promise<InventoryPage<InventoryStockLevel>> {
  const qs = inventoryQueryString(params);
  return apiFetch<InventoryPage<InventoryStockLevel>>(`/v1/inventory/stock${qs ? `?${qs}` : ''}`);
}

export function getInventoryMovements(params: InventoryMovementParams = {}): Promise<InventoryPage<InventoryMovement>> {
  const qs = inventoryQueryString(params);
  return apiFetch<InventoryPage<InventoryMovement>>(`/v1/inventory/stock/movements${qs ? `?${qs}` : ''}`);
}

export function receiveInventoryStock(input: {
  variantId: string;
  warehouseId?: string | null;
  quantity: string;
  unitCost: { amountMinor: string; currency: string };
  referenceType: string;
  referenceId: string;
  idempotencyKey?: string;
}): Promise<{ movementId: string }> {
  return apiFetch<{ movementId: string }>('/v1/inventory/stock/receive', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function adjustInventoryStock(input: {
  variantId: string;
  warehouseId?: string | null;
  quantity: string;
  reasonCode: string;
  referenceType: string;
  referenceId: string;
}): Promise<{ movementId: string }> {
  return apiFetch<{ movementId: string }>('/v1/inventory/stock/adjust', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function transferInventoryStock(input: {
  variantId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: string;
  referenceType: string;
  referenceId: string;
}): Promise<{ transferOutId: string; transferInId: string }> {
  return apiFetch<{ transferOutId: string; transferInId: string }>('/v1/inventory/stock/transfer', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Filters for the stock-counts list (draft/applied status + pagination). */
export interface InventoryStockCountParams {
  status?: 'draft' | 'applied';
  page?: number;
  pageSize?: number;
}

export function getInventoryStockCounts(
  params: InventoryStockCountParams = {},
): Promise<InventoryPage<InventoryStockCount>> {
  const qs = inventoryQueryString(params);
  return apiFetch<InventoryPage<InventoryStockCount>>(`/v1/inventory/stock-counts${qs ? `?${qs}` : ''}`);
}

export function createInventoryStockCount(input: {
  warehouseId: string;
  notes?: string | null;
  lines: Array<{ variantId: string; countedQuantity: string }>;
}): Promise<InventoryStockCount> {
  return apiFetch<InventoryStockCount>('/v1/inventory/stock-counts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function applyInventoryStockCount(id: string): Promise<{ correctionsApplied: number }> {
  return apiFetch<{ correctionsApplied: number }>(`/v1/inventory/stock-counts/${id}/apply`, { method: 'POST' });
}

// ─── POS ─────────────────────────────────────────────────────────────────────

/** One register row (POS-1). `openShiftId` is null when the register is idle. */
export interface PosRegister {
  id: string;
  name: string;
  code: string;
  warehouseId: string;
  receiptPrefix: string;
  isActive: boolean;
  openShiftId: string | null;
  createdAt: string;
}

/** One shift row (POS-2/4/5) — closed fields are null while the shift is open. */
export interface PosShift {
  id: string;
  registerId: string;
  openedBy: string;
  openedAt: string;
  openingFloatAmountMinor: string;
  closedBy: string | null;
  closedAt: string | null;
  countedCashAmountMinor: string | null;
  expectedCashAmountMinor: string | null;
  varianceAmountMinor: string | null;
  currency: string;
  status: 'open' | 'closed';
  forcedClose: boolean;
}

/** One sale line (pos_sale_lines) — name/sku snapshots at sale time (POS-12). */
export interface PosSaleLine {
  id: string;
  saleId: string;
  variantId: string;
  skuSnapshot: string;
  nameSnapshot: Record<string, string>;
  quantity: string;
  unitPriceAmountMinor: string;
  lineDiscountAmountMinor: string;
  taxRateBp: number;
  taxAmountMinor: string;
  lineTotalAmountMinor: string;
  currency: string;
}

/** One payment (pos_payments) — append-only (POS-10). */
export interface PosPayment {
  id: string;
  saleId: string;
  method: 'cash' | 'card' | 'other';
  amountMinor: string;
  currency: string;
  tenderedAmountMinor: string | null;
  changeAmountMinor: string;
  reference: string | null;
  capturedAt: string;
  createdBy: string | null;
}

/** One sale row with its lines + payments (POS-13 status vocabulary). */
export interface PosSale {
  id: string;
  shiftId: string;
  registerId: string;
  receiptNumber: string;
  status: 'completed' | 'partially_refunded' | 'refunded' | 'voided';
  subtotal: { amountMinor: string; currency: string };
  discount: { amountMinor: string; currency: string };
  tax: { amountMinor: string; currency: string };
  total: { amountMinor: string; currency: string };
  currency: string;
  locale: string;
  customerContactId: string | null;
  soldAt: string;
  createdAt: string;
  lines: PosSaleLine[];
  payments: PosPayment[];
}

/** One refund (POS-20..24). */
export interface PosRefund {
  id: string;
  originalSaleId: string;
  reasonCode: string;
  amount: { amountMinor: string; currency: string };
  refundedAt: string;
}

/** Shift close report (POS-8): totals + the shift's sales and refunds. */
export interface PosShiftReport {
  shift: PosShift;
  totals: {
    salesAmountMinor: string;
    refundsAmountMinor: string;
    netAmountMinor: string;
  };
  sales: PosSale[];
  refunds: PosRefund[];
}

export function getPosRegisters(): Promise<{ items: PosRegister[] }> {
  return apiFetch<{ items: PosRegister[] }>('/v1/pos/registers');
}

export function createPosRegister(input: {
  name: string;
  code: string;
  warehouseId: string;
}): Promise<{ id: string; warehouseId: string }> {
  return apiFetch<{ id: string; warehouseId: string }>('/v1/pos/registers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function openPosShift(
  registerId: string,
  input: { openingFloatAmountMinor: string },
): Promise<{ shiftId: string; openedAt: string }> {
  return apiFetch<{ shiftId: string; openedAt: string }>(`/v1/pos/registers/${registerId}/shifts/open`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function closePosShift(
  registerId: string,
  input: { countedCashAmountMinor: string; forcedClose?: boolean },
): Promise<{
  shiftId: string;
  expectedCashAmountMinor: string;
  varianceAmountMinor: string;
  closedAt: string;
}> {
  return apiFetch<{
    shiftId: string;
    expectedCashAmountMinor: string;
    varianceAmountMinor: string;
    closedAt: string;
  }>(`/v1/pos/registers/${registerId}/shifts/close`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getPosShifts(): Promise<{ items: PosShift[] }> {
  return apiFetch<{ items: PosShift[] }>('/v1/pos/shifts');
}

export function getPosShiftReport(shiftId: string): Promise<PosShiftReport> {
  return apiFetch<PosShiftReport>(`/v1/pos/shifts/${shiftId}/report`);
}

/** Checkout line — price + name snapshot at sale time (POS-12). */
export interface PosCheckoutLine {
  variantId: string;
  sku: string;
  nameI18n: Record<string, string>;
  quantity: string;
  unitPrice: { amountMinor: string; currency: string };
  lineDiscount?: { amountMinor: string; currency: string };
  taxRateBp?: number;
  currency: string;
}

export interface PosCheckoutPayment {
  method: 'cash' | 'card' | 'other';
  amount: { amountMinor: string; currency: string };
  currency: string;
  tenderedAmountMinor?: string;
  changeAmountMinor?: string;
  reference?: string | null;
}

export function createPosSale(input: {
  registerId: string;
  locale: string;
  lines: PosCheckoutLine[];
  payments: PosCheckoutPayment[];
  customerContactId?: string | null;
  idempotencyKey?: string;
}): Promise<{ saleId: string; receiptNumber: string }> {
  const { idempotencyKey, ...body } = input;
  return apiFetch<{ saleId: string; receiptNumber: string }>('/v1/pos/sales', {
    method: 'POST',
    body: JSON.stringify(body),
    ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  });
}

export interface PosSaleParams {
  status?: string;
  shiftId?: string;
  page?: number;
  pageSize?: number;
}

export function getPosSales(params: PosSaleParams = {}): Promise<PosPage<PosSale>> {
  const qs = posQueryString(params);
  return apiFetch<PosPage<PosSale>>(`/v1/pos/sales${qs ? `?${qs}` : ''}`);
}

export function getPosSale(id: string): Promise<PosSale> {
  return apiFetch<PosSale>(`/v1/pos/sales/${id}`);
}

export function voidPosSale(id: string): Promise<{ saleId: string; status: string }> {
  return apiFetch<{ saleId: string; status: string }>(`/v1/pos/sales/${id}/void`, { method: 'POST' });
}

export interface PosRefundLine {
  saleLineId: string;
  variantId: string;
  quantity: string;
  restock: boolean;
  amount: { amountMinor: string; currency: string };
  currency: string;
}

export function createPosRefund(input: {
  originalSaleId: string;
  registerId: string;
  reasonCode: string;
  currency: string;
  lines: PosRefundLine[];
}): Promise<{ refundId: string; amountMinor: string; refundedAt: string }> {
  return apiFetch<{ refundId: string; amountMinor: string; refundedAt: string }>('/v1/pos/refunds', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Paginated POS list response — `items` plus total/page/pageSize. */
export interface PosPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Rows per page for POS list views (matches the backend default clamp). */
export const POS_PAGE_SIZE = 12;

/** Serialize POS list params to a query string (absent/empty omitted). */
function posQueryString(params: PosSaleParams): string {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.shiftId) query.set('shiftId', params.shiftId);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined && params.pageSize !== POS_PAGE_SIZE)
    query.set('pageSize', String(params.pageSize));
  return query.toString();
}
