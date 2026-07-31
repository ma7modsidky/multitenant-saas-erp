// Entitlement + navigation hooks backed by the billing and navigation endpoints.

'use client';

import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '../api';
import type { BillingResponse, EntitlementState, NavigationGroup } from '../api/types';
import { useSession } from '../auth/session-context';

const ACTIVE_STATES: EntitlementState[] = ['active', 'trialing', 'past_due'];

export function useNavigation(enabled = true) {
  const { organizationId } = useSession();
  return useQuery({
    queryKey: ['navigation', organizationId],
    queryFn: () => apiFetch<NavigationGroup[]>('/v1/me/navigation', {}, { auth: true }),
    enabled: enabled && organizationId !== null,
  });
}

export function useEntitlements() {
  const { organizationId } = useSession();
  return useQuery({
    queryKey: ['entitlements', organizationId],
    queryFn: () => apiFetch<BillingResponse>(`/v1/organizations/${organizationId}/billing`, {}, { auth: true }),
    enabled: organizationId !== null,
  });
}

export function useModuleEnabled(moduleKey: string): boolean {
  const { data } = useEntitlements();
  if (!data?.entitlements) return false;
  const entitlement = data.entitlements.find((e) => e.moduleKey === moduleKey);
  return entitlement !== undefined && ACTIVE_STATES.includes(entitlement.state);
}

export function ModuleGate({
  moduleKey,
  children,
  fallback = null,
}: {
  moduleKey: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const enabled = useModuleEnabled(moduleKey);
  return <>{enabled ? children : fallback}</>;
}
