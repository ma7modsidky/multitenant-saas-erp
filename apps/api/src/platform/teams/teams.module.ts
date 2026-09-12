import { Module, type OnModuleInit } from '@nestjs/common';

import { AuditBeforeStateRegistry, tableRowLoader } from '../../core/audit/__init__.js';
import { PortRegistry } from '../../core/ports/port-registry.js';
import { TEAM_READ_PORT } from '@modubiz/contracts';

import { TeamsController } from './api/teams.controller.js';
import {
  AddTeamMemberUseCase,
  CreateTeamUseCase,
  DeleteTeamUseCase,
  ListTeamsUseCase,
  RemoveTeamMemberUseCase,
  TeamAssignmentService,
  UpdateTeamUseCase,
} from './application/team.use-cases.js';
import { TEAM_REPOSITORY } from './ports/team-repository.port.js';
import { DrizzleTeamRepository } from './infrastructure/repositories/drizzle-team.repository.js';
import { DrizzleTeamReadPort } from './infrastructure/read-ports/drizzle-team-read.port.js';

/**
 * TeamsModule — platform team management (TEAM-1) + the Level-2 read port
 * other modules use for scoped data access (AUTHZ-9).
 */
@Module({
  controllers: [TeamsController],
  providers: [
    { provide: TEAM_REPOSITORY, useClass: DrizzleTeamRepository },
    ListTeamsUseCase,
    CreateTeamUseCase,
    UpdateTeamUseCase,
    DeleteTeamUseCase,
    AddTeamMemberUseCase,
    RemoveTeamMemberUseCase,
    TeamAssignmentService,
    DrizzleTeamReadPort,
  ],
  exports: [TeamAssignmentService],
})
export class TeamsModule implements OnModuleInit {
  constructor(
    private readonly auditBeforeState: AuditBeforeStateRegistry,
    private readonly portRegistry: PortRegistry,
    // Concrete class here (not the contracts interface): Nest DI resolves
    // the class token; the registry stores the instance for consumers.
    private readonly teamReadPort: DrizzleTeamReadPort,
  ) {}

  onModuleInit(): void {
    // AUD-1 pre-mutation snapshots for @Audit({ captureBefore }).
    this.auditBeforeState.register('team', tableRowLoader('core_teams'));
    this.auditBeforeState.register('team_membership', tableRowLoader('core_team_memberships'));
    // Level-2 read port for business modules (crm scope filtering, AUTHZ-9).
    this.portRegistry.register(TEAM_READ_PORT, this.teamReadPort);
  }
}
