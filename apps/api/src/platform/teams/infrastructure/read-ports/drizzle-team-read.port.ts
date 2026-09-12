import { Inject, Injectable } from '@nestjs/common';

import { TEAM_READ_PORT, type TeamReadPort } from '@modubiz/contracts';

import { TransactionManager } from '../../../../core/database/transaction-manager.js';
import { TEAM_REPOSITORY, type TeamRepository } from '../../ports/team-repository.port.js';

/**
 * DrizzleTeamReadPort — implements the contracts TEAM_READ_PORT so business
 * modules (crm) can resolve a user's team ids for OWN/TEAM/GLOBAL scoping
 * without importing platform code (Level-2 read port).
 */
@Injectable()
export class DrizzleTeamReadPort implements TeamReadPort {
  constructor(
    @Inject(TEAM_REPOSITORY) private readonly repo: TeamRepository,
    private readonly txManager: TransactionManager,
  ) {}

  listTeamIdsForUser(organizationId: string, userId: string): Promise<string[]> {
    return this.txManager.runWithOrg(organizationId, (tx) => this.repo.listTeamIdsForUser(organizationId, userId, tx));
  }

  listLeaderTeamIds(organizationId: string, userId: string): Promise<string[]> {
    return this.txManager.runWithOrg(organizationId, (tx) => this.repo.listLeaderTeamIds(organizationId, userId, tx));
  }

  listTeamMemberUserIds(organizationId: string, teamId: string): Promise<string[]> {
    return this.txManager.runWithOrg(organizationId, (tx) => this.repo.listTeamMemberUserIds(organizationId, teamId, tx));
  }

  hasTeamMembership(organizationId: string, userId: string, teamId: string): Promise<boolean> {
    return this.txManager.runWithOrg(organizationId, (tx) =>
      this.repo.hasMember(organizationId, teamId, userId, tx),
    );
  }
}

export const TEAM_READ_PORT_TOKEN = TEAM_READ_PORT;
