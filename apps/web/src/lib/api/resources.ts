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
    sellerTaxId?: string | null;
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
  /**
   * Per-shift aggregates — present on the shifts list response only, so the
   * list can show filtered totals without fetching each shift report
   * (POS-8 semantics: Σ sale totals, Σ refund amounts).
   */
  salesCount?: number;
  salesAmountMinor?: string;
  refundsAmountMinor?: string;
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

/** Filters for the shifts list — a range on the shift's opened_at date. */
export interface PosShiftParams {
  /** Inclusive lower bound on opened_at (ISO date YYYY-MM-DD). */
  fromDate?: string;
  /** Inclusive upper bound on opened_at (ISO date YYYY-MM-DD). */
  toDate?: string;
}

export function getPosShifts(params: PosShiftParams = {}): Promise<{ items: PosShift[] }> {
  const query = new URLSearchParams();
  if (params.fromDate) query.set('fromDate', params.fromDate);
  if (params.toDate) query.set('toDate', params.toDate);
  const qs = query.toString();
  return apiFetch<{ items: PosShift[] }>(`/v1/pos/shifts${qs ? `?${qs}` : ''}`);
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
  /**
   * One status, or a comma-separated list (e.g. `completed,partially_refunded`)
   * for revenue-style sums — the server allow-lists every token (POS-13).
   */
  status?: string;
  shiftId?: string;
  /** Inclusive lower bound on sold_at (ISO date YYYY-MM-DD). */
  fromDate?: string;
  /** Inclusive upper bound on sold_at (ISO date YYYY-MM-DD). */
  toDate?: string;
  page?: number;
  pageSize?: number;
}

/** Sales list page — carries the exact Σ of the matching set (server-side). */
export interface PosSalesPage extends PosPage<PosSale> {
  /** Σ sale totals of every sale matching the filter (minor units). */
  totalAmountMinor: string;
  /**
   * Σ refunds issued in the same date window against matching sales (minor
   * units) — Net Revenue = totalAmountMinor − refundsAmountMinor.
   */
  refundsAmountMinor: string;
}

export function getPosSales(params: PosSaleParams = {}): Promise<PosSalesPage> {
  const qs = posQueryString(params);
  return apiFetch<PosSalesPage>(`/v1/pos/sales${qs ? `?${qs}` : ''}`);
}

export function getPosSale(id: string): Promise<PosSale> {
  return apiFetch<PosSale>(`/v1/pos/sales/${id}`);
}

/** Offline sale sync body (POS-26..29) — the server dedupes by idempotency_key. */
export interface PosSyncSaleInput {
  clientDeviceId: string;
  idempotencyKey: string;
  registerId: string;
  locale: string;
  soldAt: string;
  lines: PosCheckoutLine[];
  payments: PosCheckoutPayment[];
  customerContactId?: string | null;
}

/**
 * Sync an offline sale (POS-26/28/29). `replay: true` means the idempotency
 * key was already accepted — the server returns the ORIGINAL sale, never a
 * duplicate. A business rejection (e.g. oversold) throws ApiError with the
 * code while still being recorded in pos_sync_log.
 */
export function createPosOfflineSale(
  input: PosSyncSaleInput,
): Promise<{ saleId: string; receiptNumber: string; replay: boolean }> {
  return apiFetch<{ saleId: string; receiptNumber: string; replay: boolean }>('/v1/pos/sales/sync', {
    method: 'POST',
    body: JSON.stringify(input),
  });
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
  if (params.fromDate) query.set('fromDate', params.fromDate);
  if (params.toDate) query.set('toDate', params.toDate);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined && params.pageSize !== POS_PAGE_SIZE)
    query.set('pageSize', String(params.pageSize));
  return query.toString();
}

// ─── Accounting ─────────────────────────────────────────────────────────────

/** One chart-of-accounts account row (ACC-5, lazy-seeded). */
export interface AccountingAccount {
  id: string;
  code: string;
  nameI18n: Record<string, string>;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  isSystem: boolean;
  isActive: boolean;
}

/** One GL movement row in the account detail (journal line + entry header). */
export interface AccountingAccountMovement {
  id: string;
  entryId: string;
  entryNumber: number;
  entryDate: string;
  description: string;
  status: string;
  postedAt: string | null;
  debitAmountMinor: string;
  creditAmountMinor: string;
  memo: string | null;
  /** Source reference of the journal entry (e.g. 'invoice_issuance'). */
  sourceType: string;
  /** Id of the source document (e.g. the invoice) when one exists. */
  sourceId: string | null;
  /** Cumulative net (debit − credit) after this movement, minor units. */
  runningBalanceMinor: string;
}

/** Filters for the account GL history — date range + pagination. */
export interface AccountingAccountMovementsParams {
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

/** Account detail — header + balance + paginated GL history (general-ledger view). */
export interface AccountingAccountDetail {
  account: AccountingAccount;
  balance: {
    debitTotal: string;
    creditTotal: string;
    /** Signed net (debit − credit), minor units — positive = net debit. */
    netAmountMinor: string;
  };
  movements: {
    items: AccountingAccountMovement[];
    total: number;
    page: number;
    pageSize: number;
  };
}

/** One payment receipt row in the payments list (ACC-9). */
export interface AccountingPayment {
  id: string;
  method: 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other';
  /** Human-facing receipt reference, e.g. `REC-000004` (ACC-9). */
  receiptNumber: string;
  amountMinor: string;
  currency: string;
  receivedAt: string;
  reference: string | null;
  invoiceId: string;
  invoiceNumber: string;
  customerNameSnapshot: string;
  allocationAmountMinor: string;
}

/** One allocation of a payment receipt to an invoice (ACC-9 breakdown). */
export interface AccountingPaymentAllocation {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerNameSnapshot: string;
  invoiceDate: string;
  invoiceStatus: string;
  currency: string;
  amountMinor: string;
}

/** Payment receipt detail — header + allocation breakdown (ACC-9). */
export interface AccountingPaymentDetail {
  payment: {
    id: string;
    method: 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other';
    /** Human-facing receipt reference, e.g. `REC-000004` (ACC-9). */
    receiptNumber: string;
    amountMinor: string;
    currency: string;
    receivedAt: string;
    reference: string | null;
    createdBy: string | null;
    createdAt: string;
  };
  allocations: AccountingPaymentAllocation[];
  /** The receipt entry (Dr Bank/Cash, Cr AR) this payment posted — ACC-9. */
  journalEntry: { id: string; entryNumber: number } | null;
}

/** Filters for the payments list — method + date range + free-text (ACC-9). */
export interface AccountingPaymentParams {
  /** Free-text search — matches the customer name or the invoice number. */
  q?: string;
  method?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

/** One credit-note header row in the credit-notes list (ACC-10). */
export interface AccountingCreditNote {
  id: string;
  creditNoteNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  customerNameSnapshot: string;
  status: string;
  reasonCode: string;
  amountMinor: string;
  currency: string;
  issuedAt: string | null;
  createdAt: string;
}

/** One reversed line resolved to its item name (ACC-10). */
export interface AccountingCreditNoteLine {
  id: string;
  invoiceLineId: string;
  itemNameSnapshot: string;
  quantity: string;
  unitPriceAmountMinor: string;
  taxAmountMinor: string;
  lineTotalAmountMinor: string;
}

/** Credit-note detail — header + reversed lines (ACC-10). */
export interface AccountingCreditNoteDetail {
  creditNote: AccountingCreditNote & { lines: AccountingCreditNoteLine[] };
  /** The reversal entry (Dr Revenue, Cr AR) posted at issuance — ACC-10. */
  journalEntry: { id: string; entryNumber: number } | null;
}

/** Filters for the credit-notes list (ACC-10). */
export interface AccountingCreditNoteParams {
  /** Free-text search — matches the note number, invoice number, or customer name. */
  q?: string;
  page?: number;
  pageSize?: number;
}

/** One journal entry row (ACC-3) — status is posted/reversed while in draft. */
export interface AccountingJournalEntry {
  id: string;
  entryNumber: number;
  entryDate: string;
  description: string;
  currency: string;
  status: 'posted' | 'reversed' | 'draft';
  sourceType: string;
  sourceId: string | null;
  postedAt: string | null;
  /** The entry that reversed this one (ACC-2) — null unless reversed. */
  reversedByEntryId: string | null;
}

/** One journal line resolved to its account (ACC-4, journal detail view). */
export interface AccountingJournalEntryLine {
  id: string;
  accountId: string;
  accountCode: string | null;
  accountNameI18n: Record<string, string> | null;
  debitAmountMinor: string;
  creditAmountMinor: string;
  memo: string | null;
}

/** Journal entry detail — header + actor metadata + resolved lines. */
export interface AccountingJournalEntryDetail {
  entry: AccountingJournalEntry & {
    createdAt: string;
    createdBy: string | null;
    postedBy: string | null;
    /** The reversing entry (id + number) when this entry was reversed. */
    reversedBy: { id: string; entryNumber: number } | null;
    lines: AccountingJournalEntryLine[];
  };
}

/** Filters for the journal list — free-text search + a range on the entry date. */
export interface AccountingJournalParams {
  q?: string;
  fromDate?: string;
  toDate?: string;
  /** Narrow to entries posted for one source document (e.g. a purchase bill). */
  sourceType?: string;
  sourceId?: string;
  page?: number;
  pageSize?: number;
}

/** One invoice row (ACC-6/8/9/10 list response). */
export interface AccountingInvoice {
  id: string;
  invoiceNumber: string;
  customerNameSnapshot: string;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';
  invoiceDate: string;
  dueDate: string;
  currency: string;
  subtotalAmountMinor: string;
  discountAmountMinor: string;
  taxAmountMinor: string;
  totalAmountMinor: string;
  paidAmountMinor: string;
  creditedAmountMinor: string;
  sourceType: string | null;
  sourceId: string | null;
}

/** Filters for the invoices list — search + status + date range (ACC-8). */
export interface AccountingInvoiceParams {
  q?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

/** One itemized line of an invoice detail (ACC-6). */
export interface AccountingInvoiceLine {
  id: string;
  itemNameSnapshot: string;
  description: string | null;
  quantity: string;
  unitPriceAmountMinor: string;
  discountAmountMinor: string;
  taxRateBpSnapshot: number;
  taxTypeSnapshot: string;
  taxAmountMinor: string;
  lineTotalAmountMinor: string;
}

/** One payment allocated to an invoice (ACC-9 payment history timeline). */
export interface AccountingInvoicePayment {
  id: string;
  method: 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other';
  amountMinor: string;
  currency: string;
  receivedAt: string;
  reference: string | null;
  allocationAmountMinor: string;
}

/** One credit-note header issued against an invoice (ACC-10 trail). */
export interface AccountingInvoiceCreditNote {
  id: string;
  creditNoteNumber: string;
  status: string;
  reasonCode: string;
  amountMinor: string;
  currency: string;
  issuedAt: string | null;
}

/** Invoice detail — header, lines, payments, and credit notes. */
export interface AccountingInvoiceDetail {
  invoice: AccountingInvoice & {
    customerTaxIdSnapshot: string | null;
    sellerTaxId: string | null;
    createdAt: string;
    lines: AccountingInvoiceLine[];
  };
  payments: AccountingInvoicePayment[];
  creditNotes: AccountingInvoiceCreditNote[];
  /** The org's seller tax ID setting (ACC-6) — fallback when the snapshot is empty. */
  orgSellerTaxId: string | null;
  /** The AR journal entry generated at issuance (ACC-6) — links to the GL. */
  journalEntry: { id: string; entryNumber: number } | null;
}

// ─── Reports (ACC-1/ACC-8/ACC-9) ────────────────────────────────────────────

/** One trial-balance row (ACC-1) — raw totals + natural-direction net. */
export interface AccountingTrialBalanceRow {
  accountId: string;
  code: string;
  nameI18n: Record<string, string>;
  type: string;
  isSystem: boolean;
  isActive: boolean;
  debitTotalMinor: string;
  creditTotalMinor: string;
  netMinor: string;
}

export interface AccountingTrialBalance {
  rows: AccountingTrialBalanceRow[];
  totals: { debitTotalMinor: string; creditTotalMinor: string };
  balanced: boolean;
}

/** One income-statement line (revenue or expense, ACC-1). */
export interface AccountingIncomeStatementLine {
  accountId: string;
  code: string;
  nameI18n: Record<string, string>;
  netMinor: string;
}

export interface AccountingIncomeStatement {
  revenue: AccountingIncomeStatementLine[];
  expenses: AccountingIncomeStatementLine[];
  revenueTotalMinor: string;
  expenseTotalMinor: string;
  netIncomeMinor: string;
}

/** One balance-sheet line (ACC-1) — balance in the natural direction. */
export interface AccountingBalanceSheetLine {
  accountId: string;
  code: string;
  nameI18n: Record<string, string>;
  balanceMinor: string;
}

export interface AccountingBalanceSheet {
  asOfDate: string;
  assets: AccountingBalanceSheetLine[];
  liabilities: AccountingBalanceSheetLine[];
  equity: AccountingBalanceSheetLine[];
  assetTotalMinor: string;
  liabilityTotalMinor: string;
  equityTotalMinor: string;
}

/** One open invoice in the AR aging report (ACC-8/ACC-9). */
export interface AccountingAgingInvoice {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  balanceDueMinor: string;
  daysPastDue: number;
}

export interface AccountingAgingBucket {
  key: 'current' | '1_30' | '31_60' | '61_90' | '90_plus';
  invoices: AccountingAgingInvoice[];
  totalMinor: string;
}

export interface AccountingArAging {
  asOfDate: string;
  buckets: AccountingAgingBucket[];
  totalOutstandingMinor: string;
}

/** A period filter shared by the trial balance and income statement. */
export interface AccountingReportPeriod {
  fromDate?: string;
  toDate?: string;
}

export function getAccountingCoa(): Promise<{ items: AccountingAccount[] }> {
  return apiFetch<{ items: AccountingAccount[] }>('/v1/accounting/coa');
}

/** Account detail — header, current balance, and GL history (ACC-5). */
export function getAccountingAccount(
  id: string,
  params: AccountingAccountMovementsParams = {},
): Promise<AccountingAccountDetail> {
  const query = new URLSearchParams();
  if (params.fromDate) query.set('fromDate', params.fromDate);
  if (params.toDate) query.set('toDate', params.toDate);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<AccountingAccountDetail>(`/v1/accounting/coa/${id}${qs ? `?${qs}` : ''}`);
}

export function getAccountingPayments(
  params: AccountingPaymentParams = {},
): Promise<{ items: AccountingPayment[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.method) query.set('method', params.method);
  if (params.fromDate) query.set('fromDate', params.fromDate);
  if (params.toDate) query.set('toDate', params.toDate);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<{ items: AccountingPayment[]; total: number; page: number; pageSize: number }>(
    `/v1/accounting/payments${qs ? `?${qs}` : ''}`,
  );
}

/** Payment receipt detail — header + allocation breakdown (ACC-9). */
export function getAccountingPayment(id: string): Promise<AccountingPaymentDetail> {
  return apiFetch<AccountingPaymentDetail>(`/v1/accounting/payments/${id}`);
}

/** Credit-notes list — the reversal trail with its invoice + customer (ACC-10). */
export function getAccountingCreditNotes(
  params: AccountingCreditNoteParams = {},
): Promise<{ items: AccountingCreditNote[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<{ items: AccountingCreditNote[]; total: number; page: number; pageSize: number }>(
    `/v1/accounting/credit-notes${qs ? `?${qs}` : ''}`,
  );
}

/** Credit-note detail — header, reversed lines, and the reversal entry (ACC-10). */
export function getAccountingCreditNote(id: string): Promise<AccountingCreditNoteDetail> {
  return apiFetch<AccountingCreditNoteDetail>(`/v1/accounting/credit-notes/${id}`);
}

/** Rename and/or toggle active on an account — the code never changes (ACC-5). */
export function updateAccountingAccount(
  id: string,
  input: { name?: string; isActive?: boolean },
): Promise<{ accountId: string }> {
  return apiFetch<{ accountId: string }>(`/v1/accounting/coa/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** Create a custom COA account (ACC-16 — advanced_coa feature gate). */
export function createAccountingAccount(input: {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentId?: string;
}): Promise<{ accountId: string; code: string }> {
  return apiFetch<{ accountId: string; code: string }>('/v1/accounting/coa', {
    method: 'POST',
    body: JSON.stringify({
      code: input.code,
      name: input.name,
      type: input.type,
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    }),
  });
}

export function getAccountingJournal(
  params: AccountingJournalParams = {},
): Promise<{ items: AccountingJournalEntry[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.fromDate) query.set('fromDate', params.fromDate);
  if (params.toDate) query.set('toDate', params.toDate);
  if (params.sourceType) query.set('sourceType', params.sourceType);
  if (params.sourceId) query.set('sourceId', params.sourceId);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<{ items: AccountingJournalEntry[]; total: number; page: number; pageSize: number }>(
    `/v1/accounting/journal${qs ? `?${qs}` : ''}`,
  );
}

export function postAccountingJournalEntry(input: {
  entryDate: string;
  description?: string;
  currency: string;
  lines: Array<{
    accountId: string;
    debit?: { amountMinor: string; currency: string };
    credit?: { amountMinor: string; currency: string };
    memo?: string | null;
  }>;
}): Promise<{ entryId: string; entryNumber: number }> {
  // apiFetch returns the envelope's `data` field — never wrap it again.
  return apiFetch<{ entryId: string; entryNumber: number }>('/v1/accounting/journal', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function reverseAccountingJournalEntry(
  id: string,
  input: { description?: string } = {},
): Promise<{ entryId: string; reversalEntryId: string }> {
  return apiFetch<{ entryId: string; reversalEntryId: string }>(`/v1/accounting/journal/${id}/reverse`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Journal entry detail — lines resolved to accounts + actor metadata. */
export function getAccountingJournalEntry(id: string): Promise<AccountingJournalEntryDetail> {
  return apiFetch<AccountingJournalEntryDetail>(`/v1/accounting/journal/${id}`);
}

export function getAccountingInvoice(id: string): Promise<AccountingInvoiceDetail> {
  return apiFetch<AccountingInvoiceDetail>(`/v1/accounting/invoices/${id}`);
}

export function getAccountingInvoices(
  params: AccountingInvoiceParams = {},
): Promise<{ items: AccountingInvoice[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);
  if (params.fromDate) query.set('fromDate', params.fromDate);
  if (params.toDate) query.set('toDate', params.toDate);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<{ items: AccountingInvoice[]; total: number; page: number; pageSize: number }>(
    `/v1/accounting/invoices${qs ? `?${qs}` : ''}`,
  );
}

export function getAccountingTrialBalance(period: AccountingReportPeriod = {}): Promise<AccountingTrialBalance> {
  const query = new URLSearchParams();
  if (period.fromDate) query.set('fromDate', period.fromDate);
  if (period.toDate) query.set('toDate', period.toDate);
  const qs = query.toString();
  return apiFetch<AccountingTrialBalance>(`/v1/accounting/reports/trial-balance${qs ? `?${qs}` : ''}`);
}

export function getAccountingIncomeStatement(period: AccountingReportPeriod = {}): Promise<AccountingIncomeStatement> {
  const query = new URLSearchParams();
  if (period.fromDate) query.set('fromDate', period.fromDate);
  if (period.toDate) query.set('toDate', period.toDate);
  const qs = query.toString();
  return apiFetch<AccountingIncomeStatement>(`/v1/accounting/reports/income-statement${qs ? `?${qs}` : ''}`);
}

export function getAccountingBalanceSheet(asOfDate?: string): Promise<AccountingBalanceSheet> {
  const qs = asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : '';
  return apiFetch<AccountingBalanceSheet>(`/v1/accounting/reports/balance-sheet${qs}`);
}

export function getAccountingArAging(asOfDate?: string): Promise<AccountingArAging> {
  const qs = asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : '';
  return apiFetch<AccountingArAging>(`/v1/accounting/reports/ar-aging${qs}`);
}

export function issueAccountingInvoice(input: {
  customerContactId?: string | null;
  customerCompanyId?: string | null;
  customerName: string;
  customerTaxId?: string | null;
  sellerTaxId?: string | null;
  invoiceDate?: string;
  dueDate: string;
  currency: string;
  locale?: string;
  sourceType?: 'manual' | 'pos_sale';
  sourceId?: string | null;
  idempotencyKey?: string;
  lines: Array<{
    variantId?: string | null;
    itemName: string;
    description?: string | null;
    quantity?: string;
    unitPrice: { amountMinor: string; currency: string };
    discount?: { amountMinor: string; currency: string };
    taxRateId?: string | null;
    taxRateBp?: number;
    taxType?: 'standard' | 'reduced' | 'zero' | 'exempt';
    isGoods?: boolean;
  }>;
}): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const { idempotencyKey, ...body } = input;
  return apiFetch<{ invoiceId: string; invoiceNumber: string }>('/v1/accounting/invoices', {
    method: 'POST',
    body: JSON.stringify(body),
    ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  });
}

export function applyAccountingPayment(input: {
  invoiceId: string;
  method: 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other';
  amount: { amountMinor: string; currency: string };
  reference?: string | null;
  idempotencyKey?: string;
}): Promise<{ paymentId: string; invoiceId: string }> {
  const { idempotencyKey, ...body } = input;
  return apiFetch<{ paymentId: string; invoiceId: string }>('/v1/accounting/payments', {
    method: 'POST',
    body: JSON.stringify(body),
    ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  });
}

export function issueAccountingCreditNote(input: {
  invoiceId: string;
  reasonCode: string;
  lines: Array<{
    invoiceLineId: string;
    quantity?: string;
    unitPrice: { amountMinor: string; currency: string };
    taxAmount?: { amountMinor: string; currency: string };
  }>;
}): Promise<{ creditNoteId: string; creditNoteNumber: string }> {
  return apiFetch<{ creditNoteId: string; creditNoteNumber: string }>('/v1/accounting/credit-notes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ─── Platform Admin Console ────────────────────────────────────────────────
// Superuser back-office (PLT-*). Every endpoint requires the isPlatformAdmin
// claim; the API returns 403 PLATFORM_ADMIN_REQUIRED otherwise.

export interface AdminOrgSummary {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'pending_deletion';
  createdAt: string;
  memberCount: number;
  subscriptionStatus: string | null;
  activeModuleCount: number;
}

export interface AdminOrgDetail {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt: string;
  };
  members: Array<{ id: string; name: string; email: string; roleId: string }>;
  subscription: {
    id: string;
    status: string;
    billingCurrency: string;
    currentPeriodEnd: string | null;
  } | null;
  entitlements: Array<{
    moduleKey: string;
    moduleName: string;
    state: string;
    /** Permanent BILL-2 stamp — non-null means the trial was already used. */
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    activatedAt: string | null;
    disabledAt: string | null;
    /** End date of a free admin grant (PLT-8); null = unlimited grant. */
    accessUntil: string | null;
    /** True when the module is on a paid Stripe subscription item (PLT-8). */
    isPaid: boolean;
  }>;
}

export interface AdminModulePricingRow {
  moduleKey: string;
  name: string;
  description: string | null;
  icon: string | null;
  dependsOn: string[];
  /** Free-trial length in days (0 = no trial). */
  trialDays: number;
  /** Integer minor units, string (CUR-9). */
  priceMonthlyMinor: string;
  priceYearlyMinor: string;
  currency: string;
}

export interface AdminSaasSettings {
  platformName: string;
  supportEmail: string;
  trialDurationDays: number;
  allowSelfSignup: boolean;
}

export interface AdminOverview {
  organizations: { total: number; active: number; pendingDeletion: number };
  totalUsers: number;
  subscriptions: { active: number; other: number };
  modulesEnabledByKey: Record<string, number>;
}

export function getAdminOverview(): Promise<AdminOverview> {
  return apiFetch<AdminOverview>('/v1/admin/overview');
}

export function getAdminOrganizations(
  params: { search?: string; page?: number; pageSize?: number } = {},
): Promise<{ items: AdminOrgSummary[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<{ items: AdminOrgSummary[]; total: number; page: number; pageSize: number }>(
    `/v1/admin/organizations${qs ? `?${qs}` : ''}`,
  );
}

export function getAdminOrganization(orgId: string): Promise<AdminOrgDetail> {
  return apiFetch<AdminOrgDetail>(`/v1/admin/organizations/${orgId}`);
}

/** One platform-admin audit entry against an org (PLT-4 activity feed). */
export interface AdminActivityEntry {
  id: string;
  /** e.g. module.trial.extended | module.blocked | module.suspended … */
  action: string;
  actorUserId: string | null;
  actorEmail: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
}

/** Recent platform-admin actions against one org, newest first (PLT-4). */
export function getAdminOrganizationActivity(orgId: string, limit = 20): Promise<{ items: AdminActivityEntry[] }> {
  const qs = limit > 0 ? `?limit=${limit}` : '';
  return apiFetch<{ items: AdminActivityEntry[] }>(`/v1/admin/organizations/${orgId}/activity${qs}`);
}

export function adminEnableModule(
  orgId: string,
  moduleKey: string,
  options: { skipTrial?: boolean; trialDays?: number; accessUntil?: string } = {},
): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/admin/organizations/${orgId}/modules/${moduleKey}/enable`, {
    method: 'POST',
    body: JSON.stringify({
      skipTrial: options.skipTrial ?? false,
      ...(options.trialDays ? { trialDays: options.trialDays } : {}),
      ...(options.accessUntil ? { accessUntil: options.accessUntil } : {}),
    }),
  });
}

export function adminDisableModule(orgId: string, moduleKey: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/admin/organizations/${orgId}/modules/${moduleKey}/disable`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Gate a module until the org subscribes (PLT-8) — state → blocked. */
export function adminBlockModule(orgId: string, moduleKey: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/admin/organizations/${orgId}/modules/${moduleKey}/block`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Push a running (or lapsed) trial forward by `days` days (PLT-8). */
export function adminExtendTrial(orgId: string, moduleKey: string, days: number): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/admin/organizations/${orgId}/modules/${moduleKey}/trial/extend`, {
    method: 'POST',
    body: JSON.stringify({ days }),
  });
}

/** End a running trial now — moves to expired (read-only grace, BILL-3). */
export function adminStopTrial(orgId: string, moduleKey: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/admin/organizations/${orgId}/modules/${moduleKey}/trial/stop`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Revoke a paid module immediately (active → suspended). */
export function adminSuspendModule(orgId: string, moduleKey: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/admin/organizations/${orgId}/modules/${moduleKey}/suspend`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Restore full access (suspended / past_due / expired → active). */
export function adminActivateModule(orgId: string, moduleKey: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/v1/admin/organizations/${orgId}/modules/${moduleKey}/activate`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function getAdminModules(): Promise<AdminModulePricingRow[]> {
  return apiFetch<AdminModulePricingRow[]>('/v1/admin/modules');
}

export function updateAdminModulePricing(
  moduleKey: string,
  input: { priceMonthlyMinor: string; priceYearlyMinor: string; currency: string },
): Promise<AdminModulePricingRow> {
  return apiFetch<AdminModulePricingRow>(`/v1/admin/modules/${moduleKey}/pricing`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function getAdminSettings(): Promise<AdminSaasSettings> {
  return apiFetch<AdminSaasSettings>('/v1/admin/settings');
}

export function updateAdminSettings(settings: Partial<AdminSaasSettings>): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>('/v1/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}
// ─── Purchasing & Suppliers (Phase 8, PUR-*) ────────────────────────────────

export interface PurchasingSupplier {
  id: string;
  code: string;
  name: string;
  taxId: string | null;
  currency: string;
  isActive: boolean;
  balanceMinor: string;
}

export interface PurchasingSupplierParams {
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface PurchasingSupplierLedgerRow {
  id: string;
  type: string;
  amountMinor: string;
  currency: string;
  referenceType: string;
  referenceNumber: string | null;
  entryDate: string;
  createdAt: string;
}

export interface PurchasingSupplierDetail {
  supplier: {
    id: string;
    code: string;
    name: string;
    taxId: string | null;
    paymentTerms: { netDays: number; discountDays: number; discountRateBp: number };
    currency: string;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    isActive: boolean;
    createdAt: string;
  };
  balanceMinor: string;
  ledger: PurchasingSupplierLedgerRow[];
}

export interface PurchasingPurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  supplierNameSnapshot: string;
  status: string;
  totalMinor: string;
  currency: string;
}

export interface PurchasingPoLine {
  id: string;
  variantId: string | null;
  itemNameSnapshot: string;
  quantity: string;
  receivedQuantity: string;
  unitCostMinor: string;
  unitCostCurrency: string;
  taxRateBpSnapshot: number;
  lineTotalMinor: string;
}

export interface PurchasingPurchaseOrderDetail extends PurchasingPurchaseOrder {
  orderDate: string;
  expectedDate: string | null;
  subtotalMinor: string;
  discountMinor: string;
  taxMinor: string;
  notes: string | null;
  createdAt: string;
  lines: PurchasingPoLine[];
}

export interface PurchasingPoParams {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface PurchasingGrn {
  id: string;
  number: string;
  poId: string;
  poNumber: string;
  supplierId: string;
  supplierNameSnapshot: string;
  warehouseId: string | null;
  status: string;
  receivedAt: string | null;
  createdAt: string;
}

export interface PurchasingGrnLine {
  id: string;
  poLineId: string;
  variantId: string | null;
  quantity: string;
  unitCostMinor: string;
  unitCostCurrency: string;
  accepted: boolean;
}

export interface PurchasingGrnDetail extends PurchasingGrn {
  lines: PurchasingGrnLine[];
}

export interface PurchasingGrnParams {
  q?: string;
  supplierId?: string;
  page?: number;
  pageSize?: number;
}

export interface PurchasingBill {
  id: string;
  number: string;
  supplierId: string;
  supplierNameSnapshot: string;
  status: string;
  billDate: string;
  dueDate: string | null;
  currency: string;
  subtotalMinor: string;
  taxMinor: string;
  totalMinor: string;
  paidMinor: string;
}

export interface PurchasingBillLine {
  id: string;
  poLineId: string | null;
  grnLineId: string | null;
  variantId: string | null;
  itemNameSnapshot: string;
  quantity: string;
  unitCostMinor: string;
  unitCostCurrency: string;
  taxRateBpSnapshot: number;
  taxMinor: string;
  lineTotalMinor: string;
}

export interface PurchasingBillDetail extends PurchasingBill {
  poId: string | null;
  grnId: string | null;
  supplierTaxIdSnapshot: string | null;
  lines: PurchasingBillLine[];
}

export interface PurchasingBillParams {
  q?: string;
  status?: string;
  supplierId?: string;
  page?: number;
  pageSize?: number;
}

export interface PurchasingPayment {
  id: string;
  number: string;
  supplierId: string;
  supplierNameSnapshot: string;
  method: string;
  amountMinor: string;
  currency: string;
  paidAt: string;
  reference: string | null;
  createdAt: string;
}

export interface PurchasingPaymentAllocation {
  id: string;
  billId: string;
  billNumber: string;
  amountMinor: string;
  currency: string;
}

export interface PurchasingPaymentDetail extends PurchasingPayment {
  allocations: PurchasingPaymentAllocation[];
}

export interface PurchasingPaymentParams {
  q?: string;
  method?: string;
  page?: number;
  pageSize?: number;
}

export interface PurchasingSupplierReturn {
  id: string;
  number: string;
  supplierId: string;
  supplierNameSnapshot: string;
  billId: string | null;
  reasonCode: string;
  status: string;
  amountMinor: string;
  currency: string;
  createdAt: string;
}

export interface PurchasingSupplierReturnLine {
  id: string;
  variantId: string | null;
  quantity: string;
  unitCostMinor: string;
  unitCostCurrency: string;
}

export interface PurchasingSupplierReturnDetail extends PurchasingSupplierReturn {
  billNumber: string | null;
  lines: PurchasingSupplierReturnLine[];
}

export interface PurchasingReturnParams {
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface PurchasingVendorBalance {
  id: string;
  code: string;
  name: string;
  balanceMinor: string;
  currency: string;
}

export interface PurchasingPoLineInput {
  variantId?: string | null;
  itemNameSnapshot: string;
  quantity?: string;
  unitCostMinor: string;
  unitCostCurrency?: string;
  taxRateBpSnapshot?: number;
}

export interface PurchasingGrnLineInput {
  poLineId: string;
  variantId?: string | null;
  quantity: string;
  unitCostMinor: string;
  unitCostCurrency?: string;
}

export interface PurchasingBillLineInput {
  poLineId?: string | null;
  grnLineId?: string | null;
  variantId?: string | null;
  /** Item name snapshot persisted on the bill line (PUR-6). */
  itemNameSnapshot?: string;
  quantity: string;
  unitCostMinor: string;
  unitCostCurrency?: string;
  taxRateBpSnapshot?: number;
}
export function getPurchasingSuppliers(
  params: PurchasingSupplierParams = {},
): Promise<{ items: PurchasingSupplier[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<{ items: PurchasingSupplier[]; total: number; page: number; pageSize: number }>(
    `/v1/purchasing/suppliers${qs ? `?${qs}` : ''}`,
  );
}

export function getPurchasingSupplier(id: string): Promise<PurchasingSupplierDetail> {
  return apiFetch<PurchasingSupplierDetail>(`/v1/purchasing/suppliers/${id}`);
}

export function createPurchasingSupplier(input: {
  name: string;
  taxId?: string | null;
  paymentTerms?: { netDays?: number; discountDays?: number; discountRateBp?: number };
  currency?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}): Promise<{ supplierId: string; code: string }> {
  return apiFetch<{ supplierId: string; code: string }>('/v1/purchasing/suppliers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updatePurchasingSupplier(
  id: string,
  input: Partial<{ name: string; taxId: string | null; isActive: boolean }>,
): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>(`/v1/purchasing/suppliers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function getPurchasingPurchaseOrders(
  params: PurchasingPoParams = {},
): Promise<{ items: PurchasingPurchaseOrderDetail[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<{ items: PurchasingPurchaseOrderDetail[]; total: number; page: number; pageSize: number }>(
    `/v1/purchasing/purchase-orders${qs ? `?${qs}` : ''}`,
  );
}

export function getPurchasingPurchaseOrder(id: string): Promise<PurchasingPurchaseOrderDetail> {
  return apiFetch<PurchasingPurchaseOrderDetail>(`/v1/purchasing/purchase-orders/${id}`);
}

export function createPurchasingPurchaseOrder(input: {
  supplierId: string;
  currency: string;
  orderDate?: string;
  expectedDate?: string | null;
  notes?: string | null;
  lines: PurchasingPoLineInput[];
}): Promise<{ purchaseOrderId: string; number: string }> {
  return apiFetch<{ purchaseOrderId: string; number: string }>('/v1/purchasing/purchase-orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function approvePurchasingPurchaseOrder(id: string): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>(`/v1/purchasing/purchase-orders/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function getPurchasingGrns(
  params: PurchasingGrnParams = {},
): Promise<{ items: PurchasingGrn[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.supplierId) query.set('supplierId', params.supplierId);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<{ items: PurchasingGrn[]; total: number; page: number; pageSize: number }>(
    `/v1/purchasing/grns${qs ? `?${qs}` : ''}`,
  );
}

export function getPurchasingGrn(id: string): Promise<PurchasingGrnDetail> {
  return apiFetch<PurchasingGrnDetail>(`/v1/purchasing/grns/${id}`);
}

export function receivePurchasingGrn(input: {
  poId: string;
  warehouseId?: string | null;
  idempotencyKey?: string | null;
  lines: PurchasingGrnLineInput[];
}): Promise<{ grnId: string; number: string }> {
  return apiFetch<{ grnId: string; number: string }>('/v1/purchasing/grns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getPurchasingBills(
  params: PurchasingBillParams = {},
): Promise<{ items: PurchasingBill[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);
  if (params.supplierId) query.set('supplierId', params.supplierId);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<{ items: PurchasingBill[]; total: number; page: number; pageSize: number }>(
    `/v1/purchasing/bills${qs ? `?${qs}` : ''}`,
  );
}

export function getPurchasingBill(id: string): Promise<PurchasingBillDetail> {
  return apiFetch<PurchasingBillDetail>(`/v1/purchasing/bills/${id}`);
}

export function createPurchasingBill(input: {
  supplierId: string;
  poId?: string | null;
  grnId?: string | null;
  billDate?: string;
  dueDate?: string | null;
  currency: string;
  supplierTaxIdSnapshot?: string | null;
  lines: PurchasingBillLineInput[];
}): Promise<{ billId: string; number: string }> {
  return apiFetch<{ billId: string; number: string }>('/v1/purchasing/bills', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function approvePurchasingBill(id: string, idempotencyKey?: string | null): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>(`/v1/purchasing/bills/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify(idempotencyKey ? { idempotencyKey } : {}),
  });
}

export function getPurchasingPayments(
  params: PurchasingPaymentParams = {},
): Promise<{ items: PurchasingPayment[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.method) query.set('method', params.method);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<{ items: PurchasingPayment[]; total: number; page: number; pageSize: number }>(
    `/v1/purchasing/payments${qs ? `?${qs}` : ''}`,
  );
}

export function getPurchasingPayment(id: string): Promise<PurchasingPaymentDetail> {
  return apiFetch<PurchasingPaymentDetail>(`/v1/purchasing/payments/${id}`);
}

export function recordPurchasingPayment(input: {
  supplierId: string;
  method: string;
  amountMinor: string;
  currency: string;
  paidAt?: string;
  reference?: string | null;
  allocations: Array<{ billId: string; amountMinor: string }>;
  idempotencyKey?: string | null;
}): Promise<{ paymentId: string; number: string }> {
  return apiFetch<{ paymentId: string; number: string }>('/v1/purchasing/payments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getPurchasingReturns(
  params: PurchasingReturnParams = {},
): Promise<{ items: PurchasingSupplierReturn[]; total: number; page: number; pageSize: number }> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.page !== undefined && params.page > 1) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<{ items: PurchasingSupplierReturn[]; total: number; page: number; pageSize: number }>(
    `/v1/purchasing/returns${qs ? `?${qs}` : ''}`,
  );
}

export function getPurchasingReturn(id: string): Promise<PurchasingSupplierReturnDetail> {
  return apiFetch<PurchasingSupplierReturnDetail>(`/v1/purchasing/returns/${id}`);
}

export function createPurchasingReturn(input: {
  supplierId: string;
  billId?: string | null;
  grnLineId?: string | null;
  reasonCode: string;
  currency: string;
  lines: Array<{ variantId?: string | null; quantity: string; unitCostMinor: string; unitCostCurrency?: string }>;
}): Promise<{ returnId: string; number: string }> {
  return apiFetch<{ returnId: string; number: string }>('/v1/purchasing/returns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function approvePurchasingReturn(id: string, idempotencyKey?: string | null): Promise<Record<string, unknown>> {
  return apiFetch<Record<string, unknown>>(`/v1/purchasing/returns/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify(idempotencyKey ? { idempotencyKey } : {}),
  });
}

export function getPurchasingVendorBalances(): Promise<{
  suppliers: PurchasingVendorBalance[];
  totalBalanceMinor: string;
}> {
  return apiFetch<{ suppliers: PurchasingVendorBalance[]; totalBalanceMinor: string }>(
    '/v1/purchasing/vendor-balances',
  );
}
