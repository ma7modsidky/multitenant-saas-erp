import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { type TeamReadPort } from '@modubiz/contracts';

import type { PortRegistry } from '../../../../core/ports/port-registry.js';
import { TenantContext } from '../../../../core/tenancy/tenant-context.js';
import { assertOwnershipChange, resolveScopeFilter } from '../../api/scope.js';

/**
 * Unit coverage for the CRM scope/ownership guards (AUTHZ-9/10, TEAM-4/5/6,
 * CRM-16) against a stubbed TeamReadPort — no database needed: RLS is
 * exercised by the integration/isolation suites, the transition MATRIX here.
 */

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const ME = '00000000-0000-4000-8000-000000000002';
const TEAMMATE = '00000000-0000-4000-8000-000000000003';
const OUTSIDER = '00000000-0000-4000-8000-000000000004';
const TEAM_A = '00000000-0000-4000-8000-000000000010';
const TEAM_B = '00000000-0000-4000-8000-000000000011';

interface TeamConfig {
  myTeams?: string[];
  ledTeams?: string[];
  /** Per-team member lists for teams I lead. */
  members?: Record<string, string[]>;
}

function makeRegistry(config: TeamConfig): PortRegistry {
  const teamPort: TeamReadPort = {
    listTeamIdsForUser: async (_orgId: string, userId: string) => {
      if (userId !== ME) return [];
      // Leaders are implicitly members of their led teams.
      return [...new Set([...(config.myTeams ?? []), ...(config.ledTeams ?? [])])];
    },
    listLeaderTeamIds: async () => config.ledTeams ?? [],
    listTeamMemberUserIds: async (_orgId: string, teamId: string) => config.members?.[teamId] ?? [],
    hasTeamMembership: async () => false,
  };
  return { resolve: () => teamPort } as unknown as PortRegistry;
}

function runAs(_config: TeamConfig, fn: () => Promise<void>): Promise<void> {
  return TenantContext.run(
    {
      userId: ME,
      sessionId: undefined,
      organizationId: ORG_ID,
      roles: ['member'],
      permissions: [],
      locale: 'en',
    },
    fn,
  );
}

describe('CRM list scoping (AUTHZ-10 / TEAM-4)', () => {
  it('AUTHZ-10: an unscoped member request clamps to OWN + team pool + global pool', async () => {
    const config = { myTeams: [TEAM_A] };
    await runAs(config, async () => {
      expect(await resolveScopeFilter('all', makeRegistry(config))).toEqual({
        ownPool: { userId: ME, teamIds: [TEAM_A] },
      });
    });
  });

  it('AUTHZ-10: a user without any team still sees their records plus the GLOBAL pool', async () => {
    const config = {};
    await runAs(config, async () => {
      expect(await resolveScopeFilter('all', makeRegistry(config))).toEqual({
        ownPool: { userId: ME, teamIds: [] },
      });
    });
  });

  it('TEAM-4: a leader sees every record owned by led teams or their members', async () => {
    const config = { ledTeams: [TEAM_A], members: { [TEAM_A]: [TEAMMATE] } };
    await runAs(config, async () => {
      expect(await resolveScopeFilter('all', makeRegistry(config))).toEqual({
        ownerTeamIds: [TEAM_A],
        ownerUserIds: [TEAMMATE],
      });
    });
  });

  it("AUTHZ-10: scope=mine always narrows to exactly the caller's own records", async () => {
    const config = { myTeams: [TEAM_A] };
    await runAs(config, async () => {
      expect(await resolveScopeFilter('mine', makeRegistry(config))).toEqual({ ownerUserId: ME });
    });
  });
});

describe('Ownership transitions (CRM-16 / TEAM-5)', () => {
  const baseCtx = (overrides: Record<string, unknown>) => ({
    organizationId: ORG_ID,
    actorUserId: ME,
    currentOwnerUserId: null as string | null,
    currentOwnerTeamId: null as string | null,
    ...overrides,
  });

  it('CRM-16: a plain member CANNOT claim a teammate-owned record even sharing the team', async () => {
    const config = { myTeams: [TEAM_A] };
    await runAs(config, async () => {
      await expect(
        assertOwnershipChange(
          makeRegistry(config),
          baseCtx({ currentOwnerUserId: TEAMMATE, currentOwnerTeamId: TEAM_A, nextOwnerUserId: ME }),
        ),
      ).rejects.toThrow('OWNER_SCOPE_DENIED');
    });
  });

  it("CRM-16: a plain member CANNOT claim another team's pool record", async () => {
    const config = { myTeams: [TEAM_A] };
    await runAs(config, async () => {
      await expect(
        assertOwnershipChange(
          makeRegistry(config),
          baseCtx({ currentOwnerUserId: null, currentOwnerTeamId: TEAM_B, nextOwnerUserId: ME }),
        ),
      ).rejects.toThrow('OWNER_SCOPE_DENIED');
    });
  });

  it('CRM-16: a member can claim an unassigned record from THEIR team pool', async () => {
    const config = { myTeams: [TEAM_A] };
    await runAs(config, async () => {
      await expect(
        assertOwnershipChange(
          makeRegistry(config),
          baseCtx({ currentOwnerUserId: null, currentOwnerTeamId: TEAM_A, nextOwnerUserId: ME }),
        ),
      ).resolves.toBeUndefined();
    });
  });

  it('CRM-16: anyone can claim a GLOBAL-pool record (no owner, no team)', async () => {
    const config = {};
    await runAs(config, async () => {
      await expect(
        assertOwnershipChange(makeRegistry(config), baseCtx({ nextOwnerUserId: ME })),
      ).resolves.toBeUndefined();
    });
  });

  it('TEAM-6: a LEADER can take over a record owned by a member of their team', async () => {
    const config = { ledTeams: [TEAM_A], members: { [TEAM_A]: [TEAMMATE] } };
    await runAs(config, async () => {
      await expect(
        assertOwnershipChange(
          makeRegistry(config),
          baseCtx({ currentOwnerUserId: TEAMMATE, currentOwnerTeamId: TEAM_A, nextOwnerUserId: ME }),
        ),
      ).resolves.toBeUndefined();
    });
  });

  it('CRM-16: a member CANNOT reassign their own record to a non-teammate', async () => {
    const config = { myTeams: [TEAM_A] };
    await runAs(config, async () => {
      // OUTSIDER has no teams ⇒ no shared team with ME.
      await expect(
        assertOwnershipChange(makeRegistry(config), baseCtx({ currentOwnerUserId: ME, nextOwnerUserId: OUTSIDER })),
      ).rejects.toThrow('OWNER_SCOPE_DENIED');
    });
  });

  it('CRM-16: unassigning a team-pool record back to the pool is allowed for its members', async () => {
    const config = { myTeams: [TEAM_A] };
    await runAs(config, async () => {
      await expect(
        assertOwnershipChange(makeRegistry(config), baseCtx({ nextOwnerUserId: null })),
      ).resolves.toBeUndefined();
    });
  });
});
