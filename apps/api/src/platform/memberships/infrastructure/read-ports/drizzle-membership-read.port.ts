import { type MembershipReadPort } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../../core/database/transaction-manager.js';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from '../../ports/index.js';

/**
 * DrizzleMembershipReadPort — implements `MembershipReadPort` (Level 2 read
 * port declared in @modubiz/contracts) for the CRM module.
 *
 * Resolves the org's ACTIVE, non-deleted member ids. Runs inside
 * TransactionManager so the read is RLS-bound to the current tenant.
 *
 * Registered in the core PortRegistry by MembershipsModule.onModuleInit;
 * consumers resolve the token and never import this class.
 *
 * @see ARCHITECTURE.md §6 — Level 2: read-only query port
 */
@Injectable()
export class DrizzleMembershipReadPort implements MembershipReadPort {
  constructor(
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async listActiveMemberIds(organizationId: string): Promise<string[]> {
    return this.txManager.run(async (tx) => {
      const members = await this.membershipRepo.findByOrgId(organizationId, tx);
      return members.filter((m) => m.status === 'active' && m.deletedAt === null).map((m) => m.userId);
    });
  }
}
