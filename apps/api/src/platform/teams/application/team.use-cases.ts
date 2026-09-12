import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import {
  assertTeamFound,
  assertTeamNameFree,
  type TeamData,
} from '../domain/team.entity.js';
import { TEAM_REPOSITORY, type TeamRepository } from '../ports/team-repository.port.js';

/**
 * Team use cases — CRUD + membership management for core_teams.
 *
 * All reads/writes run inside TransactionManager.run() so the org-scoped RLS
 * context is bound (TEN-3). The caller passes the organizationId explicitly
 * because team routes are org-addressed (`/organizations/:orgId/teams`), and
 * the transaction manager binds that org for RLS via runWithOrg where the
 * route is not already inside an org-bound context.
 */
@Injectable()
export class ListTeamsUseCase {
  constructor(
    @Inject(TEAM_REPOSITORY) private readonly repo: TeamRepository,
    private readonly txManager: TransactionManager,
  ) {}
  execute(organizationId: string) {
    return this.txManager.runWithOrg(organizationId, (tx) => this.repo.listWithMembers(organizationId, tx));
  }
}

@Injectable()
export class CreateTeamUseCase {
  constructor(
    @Inject(TEAM_REPOSITORY) private readonly repo: TeamRepository,
    private readonly txManager: TransactionManager,
  ) {}
  async execute(input: {
    organizationId: string;
    name: string;
    description: string | null;
    leaderUserId: string | null;
    memberUserIds: string[];
    actorUserId: string;
  }): Promise<TeamData> {
    return this.txManager.runWithOrg(input.organizationId, async (tx) => {
      assertTeamNameFree(await this.repo.findByName(input.organizationId, input.name.trim(), tx));
      const team = await this.repo.insert(
        {
          id: crypto.randomUUID(),
          organizationId: input.organizationId,
          name: input.name.trim(),
          description: input.description,
          leaderUserId: input.leaderUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: input.actorUserId,
          updatedBy: input.actorUserId,
          deletedAt: null,
        },
        tx,
      );
      const allMembers = new Set(input.memberUserIds);
      if (input.leaderUserId) allMembers.add(input.leaderUserId);
      for (const userId of allMembers) {
        await this.repo.addMember(
          { organizationId: input.organizationId, teamId: team.id, userId, actorUserId: input.actorUserId },
          tx,
        );
      }
      return team;
    });
  }
}

@Injectable()
export class UpdateTeamUseCase {
  constructor(
    @Inject(TEAM_REPOSITORY) private readonly repo: TeamRepository,
    private readonly txManager: TransactionManager,
  ) {}
  async execute(input: {
    teamId: string;
    organizationId: string;
    name?: string;
    description?: string | null;
    leaderUserId?: string | null;
    memberUserIds?: string[];
    actorUserId: string;
  }): Promise<TeamData> {
    return this.txManager.runWithOrg(input.organizationId, async (tx) => {
      assertTeamFound(await this.repo.findById(input.teamId, tx), input.teamId);
      if (input.name !== undefined) {
        assertTeamNameFree(await this.repo.findByName(input.organizationId, input.name.trim(), tx), input.teamId);
      }

      const patch: Partial<TeamData> = { updatedBy: input.actorUserId };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.description !== undefined) patch.description = input.description;
      if (input.leaderUserId !== undefined) patch.leaderUserId = input.leaderUserId;
      const team = await this.repo.update(input.teamId, patch, tx);
      assertTeamFound(team, input.teamId);

      // Membership sync: add newly picked members, remove unchecked ones.
      // The leader is ALWAYS kept a member — a leader outside their team
      // would make the TEAM scope incoherent for them.
      if (input.memberUserIds !== undefined && team) {
        const current = (await this.repo.listWithMembers(input.organizationId, tx)).find(
          (candidate) => candidate.id === team.id,
        )?.memberUserIds;
        const desired = new Set(input.memberUserIds);
        if (team.leaderUserId) desired.add(team.leaderUserId);
        for (const userId of current ?? []) {
          if (!desired.has(userId)) {
            await this.repo.removeMember({ organizationId: input.organizationId, teamId: team.id, userId }, tx);
          }
        }
        for (const userId of desired) {
          if (!current?.includes(userId)) {
            await this.repo.addMember(
              { organizationId: input.organizationId, teamId: team.id, userId, actorUserId: input.actorUserId },
              tx,
            );
          }
        }
      }
      return team as TeamData;
    });
  }
}

@Injectable()
export class DeleteTeamUseCase {
  constructor(
    @Inject(TEAM_REPOSITORY) private readonly repo: TeamRepository,
    private readonly txManager: TransactionManager,
  ) {}
  async execute(input: { teamId: string; organizationId: string }): Promise<void> {
    await this.txManager.runWithOrg(input.organizationId, async (tx) => {
      assertTeamFound(await this.repo.findById(input.teamId, tx), input.teamId);
      await this.repo.softDelete(input.teamId, tx);
    });
  }
}

@Injectable()
export class AddTeamMemberUseCase {
  constructor(
    @Inject(TEAM_REPOSITORY) private readonly repo: TeamRepository,
    private readonly txManager: TransactionManager,
  ) {}
  async execute(input: {
    organizationId: string;
    teamId: string;
    userId: string;
    actorUserId: string;
  }): Promise<void> {
    await this.txManager.runWithOrg(input.organizationId, async (tx) => {
      assertTeamFound(await this.repo.findById(input.teamId, tx), input.teamId);
      await this.repo.addMember(
        { organizationId: input.organizationId, teamId: input.teamId, userId: input.userId, actorUserId: input.actorUserId },
        tx,
      );
    });
  }
}

@Injectable()
export class RemoveTeamMemberUseCase {
  constructor(
    @Inject(TEAM_REPOSITORY) private readonly repo: TeamRepository,
    private readonly txManager: TransactionManager,
  ) {}
  async execute(input: { organizationId: string; teamId: string; userId: string }): Promise<void> {
    await this.txManager.runWithOrg(input.organizationId, async (tx) => {
      assertTeamFound(await this.repo.findById(input.teamId, tx), input.teamId);
      // A team leader cannot be removed via this path — edit the team and
      // pick a different leader first (keeps TEAM scope coherent).
      const team = await this.repo.findById(input.teamId, tx);
      if (team?.leaderUserId === input.userId) return;
      await this.repo.removeMember({ organizationId: input.organizationId, teamId: input.teamId, userId: input.userId }, tx);
    });
  }
}

/**
 * TeamAssignmentPort implementation (contracts) — used by the memberships
 * accept-invitation flow to provision pre-assigned teams. Unknown/duplicate
 * team ids are skipped silently; a failed assignment must never block the
 * invitation acceptance itself.
 */
@Injectable()
export class TeamAssignmentService {
  constructor(
    @Inject(TEAM_REPOSITORY) private readonly repo: TeamRepository,
    private readonly txManager: TransactionManager,
  ) {}
  async assignUserToTeams(organizationId: string, userId: string, teamIds: string[], actorUserId: string): Promise<void> {
    if (teamIds.length === 0) return;
    await this.txManager.runWithOrg(organizationId, async (tx) => {
      for (const teamId of teamIds) {
        const team = await this.repo.findById(teamId, tx);
        if (!team) continue;
        await this.repo.addMember({ organizationId, teamId, userId, actorUserId }, tx);
      }
    });
  }
}
