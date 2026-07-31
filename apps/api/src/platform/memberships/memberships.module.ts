import { Module } from '@nestjs/common';

import { AuthModule } from '../../core/auth/auth.module.js';
import { MembershipsController } from './api/index.js';
import {
  InviteUserUseCase,
  AcceptInvitationUseCase,
  RemoveMemberUseCase,
  UpdateMembershipRoleUseCase,
  SwitchOrgUseCase,
} from './application/index.js';
import { DrizzleInvitationRepository } from './infrastructure/repositories/drizzle-invitation.repository.js';
import { DrizzleMembershipRepository } from './infrastructure/repositories/drizzle-membership.repository.js';
import { INVITATION_REPOSITORY, MEMBERSHIP_REPOSITORY } from './ports/index.js';

@Module({
  imports: [AuthModule],
  controllers: [MembershipsController],
  providers: [
    // Repositories
    { provide: MEMBERSHIP_REPOSITORY, useClass: DrizzleMembershipRepository },
    { provide: INVITATION_REPOSITORY, useClass: DrizzleInvitationRepository },
    // Use cases
    InviteUserUseCase,
    AcceptInvitationUseCase,
    RemoveMemberUseCase,
    UpdateMembershipRoleUseCase,
    SwitchOrgUseCase,
  ],
  exports: [
    MEMBERSHIP_REPOSITORY,
    INVITATION_REPOSITORY,
    InviteUserUseCase,
  ],
})
export class MembershipsModule {}
