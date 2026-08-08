// Shared member-name resolver — used by module detail views (CRM, inventory,
// …) to show "Created by" / "Last edited by" audit stamps. The members query
// key `['members', organizationId]` is shared with the members settings page
// and the CRM feature, so the result comes from the existing react-query cache.

'use client';

import { useQuery } from '@tanstack/react-query';

import { getMembers } from '@/lib/api/resources';
import { useSession } from '@/lib/auth/session-context';

/**
 * Active members of the current org — feeds assignee selects and audit-stamp
 * name resolution. Shares the `['members', organizationId]` query key with the
 * members settings page and the CRM feature.
 */
export function useOrgMembers() {
  const { organizationId } = useSession();
  return useQuery({
    queryKey: ['members', organizationId],
    queryFn: () => {
      if (organizationId === null) throw new Error('No organization selected');
      return getMembers(organizationId);
    },
    enabled: organizationId !== null,
  });
}

/**
 * Resolver for a member's display name by user id. Shares the members query
 * cache; returns null for unknown/removed members (callers degrade to '—').
 */
export function useMemberName() {
  const { data: members } = useOrgMembers();
  return (userId: string | null) => {
    if (!userId) return null;
    const member = (members ?? []).find((m) => m.userId === userId);
    return member ? member.name || member.email : null;
  };
}
