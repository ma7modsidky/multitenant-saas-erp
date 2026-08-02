import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { Organization, OrganizationSettings } from '../domain/index.js';
import { ORGANIZATION_REPOSITORY, type OrganizationRepository } from '../ports/index.js';

/**
 * Input for retrieving an organization.
 */
export interface GetOrganizationInput {
  organizationId: string;
}

/**
 * Result of retrieving an organization.
 */
export interface GetOrganizationOutput {
  organization: Organization;
  settings: OrganizationSettings | undefined;
}

/**
 * GetOrganizationUseCase — retrieves organization details and settings.
 *
 * Organizations are global (non-RLS) tables, so the caller must
 * verify membership access from the application layer.
 */
@Injectable()
export class GetOrganizationUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly orgRepo: OrganizationRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: GetOrganizationInput): Promise<GetOrganizationOutput> {
    const orgData = await this.orgRepo.findById(input.organizationId);

    if (!orgData) {
      throw new NotFoundError('ORG_NOT_FOUND', { organizationId: input.organizationId });
    }

    const organization = Organization.fromPersistence(orgData);

    // Load settings inside a tenant-bound transaction: core_organization_settings
    // is an RLS-protected table, so reading it outside TransactionManager.run()
    // fails closed and settings would always be null.
    const settingsData = await this.txManager.run((tx) => this.orgRepo.findSettingsByOrgId(input.organizationId, tx));
    const settings = settingsData ? OrganizationSettings.fromPersistence(settingsData) : undefined;

    return { organization, settings };
  }
}
