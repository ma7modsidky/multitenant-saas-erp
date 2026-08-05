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
  /** Deal sort key (table view). Default `updatedAt`. */
  sortBy?: 'updatedAt' | 'createdAt' | 'title' | 'value';
  /** Deal sort direction (table view). Default `desc`. */
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
