// Entitlement + navigation hooks backed by the billing and navigation endpoints.

'use client';

import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '../api';
import { getDashboardWidgets } from '../api/resources';
import type { BillingResponse, EntitlementState, NavigationGroup } from '../api/types';
import { sessionStore } from '../auth/session';
import { useSession } from '../auth/session-context';

import { ModuleStateBadge } from './module-state-badge';

export { ModuleStateBadge };

const ACTIVE_STATES: EntitlementState[] = ['active', 'trialing', 'past_due'];

export function useNavigation(enabled = true) {
  const { organizationId } = useSession();
  return useQuery({
    queryKey: ['navigation', organizationId],
    queryFn: () => apiFetch<NavigationGroup[]>('/v1/me/navigation', {}, { auth: true }),
    enabled: enabled && organizationId !== null,
  });
}

export function useDashboardWidgets(enabled = true) {
  const { organizationId } = useSession();
  return useQuery({
    queryKey: ['dashboard-widgets', organizationId],
    queryFn: () => getDashboardWidgets(),
    enabled: enabled && organizationId !== null,
  });
}

export function useEntitlements() {
  const { organizationId } = useSession();
  return useQuery({
    queryKey: ['entitlements', organizationId],
    queryFn: async () => {
      const data = await apiFetch<BillingResponse>(`/v1/organizations/${organizationId}/billing`, {}, { auth: true });
      // Offline-first shell (POS-31 pattern): write through the last-known
      // snapshot so ModuleGate still opens when the network is gone — the SW
      // serves the cached page, and the checkout must not blank out offline.
      if (organizationId) sessionStore.setCachedBilling(organizationId, data);
      return data;
    },
    // Seed from the cached snapshot synchronously: on an offline reload there
    // is no network round-trip, so the gate opens on the very first render.
    initialData: organizationId
      ? (sessionStore.getCachedBilling<BillingResponse>(organizationId) ?? undefined)
      : undefined,
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
