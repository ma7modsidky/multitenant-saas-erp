import type { TeamData } from '../domain/team.entity.js';

/**
 * TeamRepository — persistence for core_teams + core_team_memberships.
 *
 * RLS scopes every org-scoped query to the current organization (fail-closed),
 * so list methods take no organizationId while writes carry it explicitly
 * (mirrors MembershipRepository).
 */
export interface TeamRepository {
  /** List non-deleted teams with their member user ids. */
  listWithMembers(organizationId: string, tx?: unknown): Promise<Array<TeamData & { memberUserIds: string[] }>>;

  /** Find a non-deleted team by id. */
  findById(id: string, tx?: unknown): Promise<TeamData | undefined>;

  /** Find a non-deleted team by (organization, name) — uniqueness guard. */
  findByName(organizationId: string, name: string, tx?: unknown): Promise<TeamData | undefined>;

  insert(data: TeamData, tx?: unknown): Promise<TeamData>;

  update(id: string, data: Partial<TeamData>, tx?: unknown): Promise<TeamData | undefined>;

  /** Soft-delete a team and its memberships. */
  softDelete(id: string, tx?: unknown): Promise<void>;

  /** Add a user to a team (no-op when an active membership already exists). */
  addMember(
    input: { organizationId: string; teamId: string; userId: string; actorUserId: string },
    tx?: unknown,
  ): Promise<void>;

  /** Soft-delete a user's membership in a team. */
  removeMember(input: { organizationId: string; teamId: string; userId: string }, tx?: unknown): Promise<void>;

  /** Ids of non-deleted teams the user belongs to. */
  listTeamIdsForUser(organizationId: string, userId: string, tx?: unknown): Promise<string[]>;

  /** True when an active (team, user) membership exists. */
  hasMember(organizationId: string, teamId: string, userId: string, tx?: unknown): Promise<boolean>;

  /** TEAM-6: ids of teams the user leads. */
  listLeaderTeamIds(organizationId: string, userId: string, tx?: unknown): Promise<string[]>;

  /** TEAM-6: ids of active members of one team. */
  listTeamMemberUserIds(organizationId: string, teamId: string, tx?: unknown): Promise<string[]>;
}

export const TEAM_REPOSITORY = Symbol('TEAM_REPOSITORY');
