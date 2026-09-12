import { TEAM_READ_PORT, type TeamReadPort } from '@modubiz/contracts';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { PortRegistry } from '../../../core/ports/port-registry.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

/** Requested record scope for CRM lists (AUTHZ-9). */
export type CrmScope = 'mine' | 'team' | 'all';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCrmScope(value: string | undefined): CrmScope | undefined {
  if (value === undefined) return undefined;
  if (value === 'mine' || value === 'team' || value === 'all') return value;
  throw new BadRequestException('scope must be one of mine, team, all');
}

/**
 * GLOBAL ceiling (AUTHZ-10): org OWNER/ADMIN membership, or any custom role
 * carrying the admin-grade membership permission.
 */
function hasGlobalCeiling(): boolean {
  const roleKey = TenantContext.getRoles()[0] ?? '';
  if (roleKey === 'owner' || roleKey === 'admin') return true;
  return TenantContext.getPermissions().includes('platform:members:assign-role');
}

export interface ScopeFilter {
  ownerUserId?: string;
  ownerTeamIds?: string[];
  ownerUserIds?: string[];
  /** Composite OWN+POOL clamp: records I own, plus unassigned rows of my teams. */
  ownPool?: { userId: string; teamIds: string[] };
}

/**
 * Resolve the requested scope into concrete list-filter fields (AUTHZ-10):
 * - mine      → only records I own.
 * - team      → leaders/admins: every record owned by one of my teams;
 *               plain members are clamped to own+pool.
 * - all       → admins: whole tenant; leaders clamped to their teams;
 *               members clamped to own+pool.
 */
export async function resolveScopeFilter(scope: CrmScope, portRegistry: PortRegistry): Promise<ScopeFilter> {
  const userId = TenantContext.requireUserId();
  const organizationId = TenantContext.requireOrganizationId();
  const teamPort = portRegistry.resolve<TeamReadPort>(TEAM_READ_PORT);

  const myTeams = await teamPort.listTeamIdsForUser(organizationId, userId);
  const ledTeams = await teamPort.listLeaderTeamIds(organizationId, userId);
  // Filter out any empty/invalid teamIds to avoid SQL `IN ()` errors downstream
  const validTeams = myTeams.filter((id): id is string => typeof id === 'string' && id.length > 0);
  const validLedTeams = ledTeams.filter((id): id is string => typeof id === 'string' && id.length > 0);
  // Composite OWN+POOL clamp: records I own, plus the pools of my teams.
  // A user with no teams still sees the GLOBAL pool (`teamIds: []` is handled
  // by the repositories as "own records + unassigned-with-no-team").
  const ownPool: ScopeFilter = { ownPool: { userId, teamIds: validTeams } };

  if (scope === 'mine') return { ownerUserId: userId };
  if (scope === 'team') {
    if (!validTeams.length) return ownPool;
    // Leader sees all entries of teams they lead (whether assigned or pool,
    // including member-owned records even if owner_team_id is not set)
    if (validLedTeams.length > 0) {
      const members = (
        await Promise.all(validLedTeams.map((teamId) => teamPort.listTeamMemberUserIds(organizationId, teamId)))
      ).flat();
      const uniqueMembers = [...new Set(members)];
      return { ownerTeamIds: validLedTeams, ownerUserIds: uniqueMembers };
    }
    if (hasGlobalCeiling()) return { ownerTeamIds: validTeams };
    return ownPool;
  }
  // 'all'
  if (hasGlobalCeiling()) return {};
  if (validLedTeams.length > 0) {
    const members = (
      await Promise.all(validLedTeams.map((teamId) => teamPort.listTeamMemberUserIds(organizationId, teamId)))
    ).flat();
    const uniqueMembers = [...new Set(members)];
    return { ownerTeamIds: validLedTeams, ownerUserIds: uniqueMembers };
  }
  return ownPool;
}

/**
 * View-permission check for single-record detail endpoints.
 * Throws 404 if the actor cannot view the record (fail-closed, same as RLS).
 * Member: own + pool of my teams. Leader: all records of led teams
 * (whether assigned or pool, and also records owned by members of those teams
 * even if owner_team_id is not set). Admin: all.
 */
export async function assertCanViewRecord(
  portRegistry: PortRegistry,
  record:
    | {
        ownerUserId?: string | null;
        ownerTeamId?: string | null;
        assignedTo?: string | null;
        assignedTeamId?: string | null;
      }
    | null
    | undefined,
): Promise<void> {
  if (!record) return;
  const ownerUserId =
    (record as { ownerUserId?: string | null }).ownerUserId ??
    (record as { assignedTo?: string | null; assignedToUserId?: string | null }).assignedTo ??
    (record as { assignedToUserId?: string | null }).assignedToUserId ??
    null;
  const ownerTeamId =
    (record as { ownerTeamId?: string | null }).ownerTeamId ??
    (record as { assignedTeamId?: string | null }).assignedTeamId ??
    null;

  // Global can view all
  if (hasGlobalCeiling()) return;
  const userId = TenantContext.requireUserId();
  const organizationId = TenantContext.requireOrganizationId();
  const teamPort = portRegistry.resolve<TeamReadPort>(TEAM_READ_PORT);

  // Global pool: no owner and no team — visible to everyone in the tenant
  if (ownerUserId === null && ownerTeamId === null) return;
  // Own record
  if (ownerUserId !== null && ownerUserId === userId) return;
  // Pool: unassigned but team-owned by one of my teams
  if (ownerUserId === null && ownerTeamId !== null) {
    const myTeams = await teamPort.listTeamIdsForUser(organizationId, userId);
    if (myTeams.includes(ownerTeamId)) return;
  }
  // Leader: any record of a team I lead (team-owned) OR owned by a member
  // of a led team even if the record has no team (covers pre-team data).
  const ledTeams = await teamPort.listLeaderTeamIds(organizationId, userId);
  if (ledTeams.length > 0) {
    if (ownerTeamId !== null && ledTeams.includes(ownerTeamId)) return;
    // Check if owner is a member of any led team
    if (ownerUserId !== null) {
      for (const teamId of ledTeams) {
        const members = await teamPort.listTeamMemberUserIds(organizationId, teamId);
        if (members.includes(ownerUserId)) return;
      }
    }
  }

  // Otherwise, hide existence
  const { NotFoundError } = await import('../../../core/common/errors.js');
  throw new NotFoundError('RECORD_NOT_FOUND', {});
}

export interface OwnershipDefaults {
  ownerUserId: string | null;
  ownerTeamId: string | null;
}

/**
 * TEAM-2 auto-assignment on CREATE, scope-enforced: default owner is the
 * creating user with their primary team. An explicit different owner requires
 * GLOBAL ceiling or leader-of-a-team containing that user.
 */
export async function resolveOwnershipDefaults(
  portRegistry: PortRegistry,
  input: { ownerUserId?: string | null; ownerTeamId?: string | null },
): Promise<OwnershipDefaults> {
  const userId = TenantContext.requireUserId();
  const organizationId = TenantContext.requireOrganizationId();
  const teamPort = portRegistry.resolve<TeamReadPort>(TEAM_READ_PORT);
  const explicitOwner = input.ownerUserId !== undefined ? input.ownerUserId : userId;
  const ownerUserId = explicitOwner;

  // Explicit owner to another user: must be global or share a team (member→teammate, leader→member)
  if (explicitOwner !== null && explicitOwner !== userId && input.ownerUserId !== undefined) {
    if (!hasGlobalCeiling()) {
      const myTeams = await teamPort.listTeamIdsForUser(organizationId, userId);
      const targetTeams = await teamPort.listTeamIdsForUser(organizationId, explicitOwner);
      const commonTeam = myTeams.some((teamId) => targetTeams.includes(teamId));
      const isLeader = (await teamPort.listLeaderTeamIds(organizationId, userId)).length > 0;
      // Member can assign to teammate in same team; leader can assign to any of their team members
      if (!commonTeam && !isLeader) throw new ForbiddenException('OWNER_SCOPE_DENIED');
      if (isLeader) {
        const ledTeams = await teamPort.listLeaderTeamIds(organizationId, userId);
        let ok = false;
        for (const teamId of ledTeams) {
          const members = await teamPort.listTeamMemberUserIds(organizationId, teamId);
          if (members.includes(explicitOwner)) {
            ok = true;
            break;
          }
        }
        if (!ok && !commonTeam) throw new ForbiddenException('OWNER_SCOPE_DENIED');
      }
    }
  }

  if (input.ownerTeamId !== undefined) {
    if (input.ownerTeamId !== null) {
      const allowed =
        hasGlobalCeiling() || (await teamPort.hasTeamMembership(organizationId, userId, input.ownerTeamId));
      if (!allowed) {
        // Leaders can also assign to teams they lead even if not explicit member
        const ledTeams = await teamPort.listLeaderTeamIds(organizationId, userId);
        if (!ledTeams.includes(input.ownerTeamId)) throw new ForbiddenException('OWNER_SCOPE_DENIED');
      }
    }
    return { ownerUserId, ownerTeamId: input.ownerTeamId };
  }

  const ownerTeamId =
    ownerUserId === userId ? ((await teamPort.listTeamIdsForUser(organizationId, userId))[0] ?? null) : null;
  return { ownerUserId, ownerTeamId };
}

interface OwnershipChangeContext {
  organizationId: string;
  actorUserId: string;
  /** Current owner on the stored record — null on creation. */
  currentOwnerUserId: string | null;
  currentOwnerTeamId: string | null;
  nextOwnerUserId?: string | null | undefined;
  nextOwnerTeamId?: string | null | undefined;
}

/**
 * TEAM-6 ownership-transition guard. Simplified and aligned with view rules:
 * - GLOBAL (OWNER/ADMIN or admin-grade permission): allow all
 * - Unassign (next = null): allow if current is viewable (own, pool, or led team)
 * - Claim (next = me): allow only if current is unassigned (global/team pool)
 *   or already mine; leaders may also take over any record visible to them
 * - Member reassign own → teammate in same team: allow
 * - Leader reassign: allow if current is viewable as leader and next is member of led team
 */
export async function assertOwnershipChange(portRegistry: PortRegistry, ctx: OwnershipChangeContext): Promise<void> {
  if (hasGlobalCeiling()) return;

  const teamPort = portRegistry.resolve<TeamReadPort>(TEAM_READ_PORT);
  const deny = () => {
    throw new ForbiddenException('OWNER_SCOPE_DENIED');
  };

  const nextOwnerId = ctx.nextOwnerUserId !== undefined ? ctx.nextOwnerUserId : ctx.currentOwnerUserId;
  const nextTeamId = ctx.nextOwnerTeamId !== undefined ? ctx.nextOwnerTeamId : ctx.currentOwnerTeamId;

  const ledTeams = await teamPort.listLeaderTeamIds(ctx.organizationId, ctx.actorUserId);
  const isLeader = ledTeams.length > 0;
  const myTeams = await teamPort.listTeamIdsForUser(ctx.organizationId, ctx.actorUserId);

  // Helper: is this record viewable by the actor? (same logic as assertCanViewRecord)
  const isViewable = async (ownerUserId: string | null, ownerTeamId: string | null): Promise<boolean> => {
    if (ownerUserId !== null && ownerUserId === ctx.actorUserId) return true;
    if (ownerUserId === null && ownerTeamId !== null && myTeams.includes(ownerTeamId)) return true;
    if (isLeader) {
      if (ownerTeamId !== null && ledTeams.includes(ownerTeamId)) return true;
      if (ownerUserId !== null) {
        for (const teamId of ledTeams) {
          const members = await teamPort.listTeamMemberUserIds(ctx.organizationId, teamId);
          if (members.includes(ownerUserId)) return true;
        }
      }
    }
    return false;
  };

  // Team-field changes alone must be to a team the actor belongs to or leads
  if (ctx.nextOwnerTeamId !== undefined && nextTeamId !== null) {
    const canAssignTeam = isLeader ? ledTeams.includes(nextTeamId) : myTeams.includes(nextTeamId);
    if (!canAssignTeam) deny();
  }

  // Unassign: next = null (user cleared, keeps team). Allow if current is
  // viewable (own, pool, or led team). Clearing an already fully-unassigned
  // record is a visible no-op for everyone — allow it too.
  if (nextOwnerId === null) {
    const alreadyUnassigned = ctx.currentOwnerUserId === null && ctx.currentOwnerTeamId === null;
    if (alreadyUnassigned || (await isViewable(ctx.currentOwnerUserId, ctx.currentOwnerTeamId))) return;
    deny();
  }

  // Claim (next = me): the record must currently be UNASSIGNED AND visible to
  // the actor as a pool (global pool with no team, or a pool of one of the
  // actor's teams) — or already mine. A member can never take over a record
  // owned by someone else (CRM-16); only a leader with visibility over it may.
  if (nextOwnerId === ctx.actorUserId) {
    const claimable =
      ctx.currentOwnerUserId === ctx.actorUserId ||
      (ctx.currentOwnerUserId === null &&
        (ctx.currentOwnerTeamId === null || myTeams.includes(ctx.currentOwnerTeamId)));
    if (claimable) return;
    if (isLeader && (await isViewable(ctx.currentOwnerUserId, ctx.currentOwnerTeamId))) return;
    deny();
  }

  // Member reassign own → teammate in same team
  if (ctx.currentOwnerUserId === ctx.actorUserId && nextOwnerId !== null && nextOwnerId !== ctx.actorUserId) {
    const targetTeams = await teamPort.listTeamIdsForUser(ctx.organizationId, nextOwnerId);
    const commonTeam = myTeams.some((teamId) => targetTeams.includes(teamId));
    if (commonTeam) return;
  }

  // Leader reassign: current must be viewable as leader, next must be member of led team (or team itself)
  if (isLeader) {
    const currentViewable = await isViewable(ctx.currentOwnerUserId, ctx.currentOwnerTeamId);
    if (currentViewable) {
      // Next owner must be in led team, or next team must be led
      if (nextTeamId !== null && ledTeams.includes(nextTeamId)) {
        // If team is set, next user must be in that team (or be null for pool)
        if (nextOwnerId === null) return;
        const members = await teamPort.listTeamMemberUserIds(ctx.organizationId, nextTeamId);
        if (members.includes(nextOwnerId)) return;
        // Also allow if next user is in any led team even if team mismatched
        for (const teamId of ledTeams) {
          const m = await teamPort.listTeamMemberUserIds(ctx.organizationId, teamId);
          if (m.includes(nextOwnerId)) return;
        }
      }
      if (nextOwnerId !== null) {
        for (const teamId of ledTeams) {
          const members = await teamPort.listTeamMemberUserIds(ctx.organizationId, teamId);
          if (members.includes(nextOwnerId)) return;
        }
      }
    }
  }

  deny();
}

/**
 * TEAM-2/CRM-14: validate an EXPLICIT activity assignment on CREATE —
 * no ownership defaults are applied to activities, but a member must not be
 * able to inject records into another team's pool or "create" a record owned
 * by someone they cannot see:
 * - assignedTeamId must be the actor's team (or one they lead), or null.
 * - assignedToUserId other than the actor requires a shared team, leadership
 *   over a led team containing them, or the GLOBAL ceiling.
 */
export async function assertAssignmentScope(
  portRegistry: PortRegistry,
  ctx: {
    organizationId: string;
    actorUserId: string;
    assignedToUserId?: string | null;
    assignedTeamId?: string | null;
  },
): Promise<void> {
  if (hasGlobalCeiling()) return;
  const teamPort = portRegistry.resolve<TeamReadPort>(TEAM_READ_PORT);
  const deny = () => {
    throw new ForbiddenException('OWNER_SCOPE_DENIED');
  };

  if (ctx.assignedTeamId !== undefined && ctx.assignedTeamId !== null) {
    const myTeams = await teamPort.listTeamIdsForUser(ctx.organizationId, ctx.actorUserId);
    const ledTeams = await teamPort.listLeaderTeamIds(ctx.organizationId, ctx.actorUserId);
    if (!myTeams.includes(ctx.assignedTeamId) && !ledTeams.includes(ctx.assignedTeamId)) deny();
  }

  if (ctx.assignedToUserId !== undefined && ctx.assignedToUserId !== null && ctx.assignedToUserId !== ctx.actorUserId) {
    const target = ctx.assignedToUserId;
    const [myTeams, targetTeams] = await Promise.all([
      teamPort.listTeamIdsForUser(ctx.organizationId, ctx.actorUserId),
      teamPort.listTeamIdsForUser(ctx.organizationId, target),
    ]);
    const commonTeam = myTeams.some((teamId) => targetTeams.includes(teamId));
    if (commonTeam) return;
    const ledTeams = await teamPort.listLeaderTeamIds(ctx.organizationId, ctx.actorUserId);
    for (const teamId of ledTeams) {
      const members = await teamPort.listTeamMemberUserIds(ctx.organizationId, teamId);
      if (members.includes(target)) return;
    }
    deny();
  }
}

export function assertUuid(value: string, name: string): void {
  if (!UUID.test(value)) {
    throw new BadRequestException(`${name} must be a valid UUID`);
  }
}
