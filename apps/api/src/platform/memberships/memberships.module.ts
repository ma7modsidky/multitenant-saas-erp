import { MEMBERSHIP_READ_PORT } from '@modubiz/contracts';
import { Module, type OnModuleInit } from '@nestjs/common';

import { AuditBeforeStateRegistry, tableRowLoader } from '../../core/audit/__init__.js';
import { AuthModule } from '../../core/auth/auth.module.js';
import { PortRegistry } from '../../core/ports/port-registry.js';
import { UsersModule } from '../users/users.module.js';

import { MembershipsController } from './api/index.js';
import {
  InviteUserUseCase,
  AcceptInvitationUseCase,
  RevokeInvitationUseCase,
  RemoveMemberUseCase,
  UpdateMembershipRoleUseCase,
  SwitchOrgUseCase,
} from './application/index.js';
import { DrizzleMembershipReadPort } from './infrastructure/read-ports/drizzle-membership-read.port.js';
import { DrizzleInvitationRepository } from './infrastructure/repositories/drizzle-invitation.repository.js';
import { DrizzleMembershipRepository } from './infrastructure/repositories/drizzle-membership.repository.js';
import { INVITATION_REPOSITORY, MEMBERSHIP_REPOSITORY } from './ports/index.js';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [MembershipsController],
  providers: [
    // Repositories
    { provide: MEMBERSHIP_REPOSITORY, useClass: DrizzleMembershipRepository },
    { provide: INVITATION_REPOSITORY, useClass: DrizzleInvitationRepository },
    // Level 2 read port implementation (consumed by business modules)
    DrizzleMembershipReadPort,
    // Use cases
    InviteUserUseCase,
    AcceptInvitationUseCase,
    RevokeInvitationUseCase,
    RemoveMemberUseCase,
    UpdateMembershipRoleUseCase,
    SwitchOrgUseCase,
  ],
  exports: [MEMBERSHIP_REPOSITORY, INVITATION_REPOSITORY, InviteUserUseCase],
})
export class MembershipsModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    // Concrete class here (not the contracts interface): Nest DI resolves
    // runtime providers, and TS interfaces are erased at compile time.
    private readonly membershipReadPort: DrizzleMembershipReadPort,
    private readonly auditBeforeState: AuditBeforeStateRegistry,
  ) {}

  onModuleInit(): void {
    this.portRegistry.register(MEMBERSHIP_READ_PORT, this.membershipReadPort);

    // AUD-1: pre-mutation snapshots for @Audit({ captureBefore }) routes.
    this.auditBeforeState.register('membership', tableRowLoader('core_memberships'));
    this.auditBeforeState.register('invitation', tableRowLoader('core_invitations'));
  }
}
