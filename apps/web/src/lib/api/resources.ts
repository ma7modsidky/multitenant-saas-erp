// Typed resource functions for the authenticated API.
// One function per endpoint the web app consumes.

import type {
  AuditLogQueryResponse,
  BillingResponse,
  InvitationResponse,
  MemberResponse,
  MembershipOrg,
  ModuleDefinition,
  NavigationGroup,
  OrganizationResponse,
  OrganizationSettingsResponse,
  RoleMatrix,
  RoleResponse,
} from './types';

import { apiFetch } from './index';

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
