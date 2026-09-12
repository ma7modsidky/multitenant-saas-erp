import { ConflictError, NotFoundError } from '../../../core/common/errors.js';

/** Domain shape for a tenant team (core_teams). */
export interface TeamData {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  leaderUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
}

export const TEAM_NOT_FOUND = 'TEAM_NOT_FOUND';
export const TEAM_NAME_TAKEN = 'TEAM_NAME_TAKEN';
export const TEAM_MEMBER_EXISTS = 'TEAM_MEMBER_EXISTS';

/** Throwing helpers kept beside the data they guard (mirrors memberships). */
export function assertTeamFound(team: TeamData | undefined, teamId: string): TeamData {
  if (!team) throw new NotFoundError(TEAM_NOT_FOUND, { teamId });
  return team;
}

export function assertTeamNameFree(existing: { id: string } | undefined, excludeTeamId?: string): void {
  if (existing && existing.id !== excludeTeamId) {
    throw new ConflictError(TEAM_NAME_TAKEN, 'A team with this name already exists');
  }
}
