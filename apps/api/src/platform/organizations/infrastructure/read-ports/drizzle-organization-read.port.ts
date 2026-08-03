import { type OrganizationReadPort } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../../core/common/errors.js';
import { TransactionManager } from '../../../../core/database/transaction-manager.js';
import { ORGANIZATION_REPOSITORY, type OrganizationRepository } from '../../ports/index.js';

/**
 * DrizzleOrganizationReadPort — implements `OrganizationReadPort` (Level 2
 * read port declared in @modubiz/contracts) for the CRM module.
 *
 * Resolves the org's base currency (CRM-8 FX snapshot needs it). Runs inside
 * TransactionManager so core_organizations reads follow the same access path
 * as the rest of the platform.
 *
 * Registered in the core PortRegistry by OrganizationsModule.onModuleInit.
 *
 * @see ARCHITECTURE.md §6 — Level 2: read-only query port
 */
@Injectable()
export class DrizzleOrganizationReadPort implements OrganizationReadPort {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly orgRepo: OrganizationRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async getBaseCurrency(organizationId: string): Promise<string> {
    return this.txManager.run(async (tx) => {
      const org = await this.orgRepo.findById(organizationId, tx);
      if (!org) {
        throw new NotFoundError('ORG_NOT_FOUND', { organizationId });
      }
      return org.baseCurrency;
    });
  }
}
