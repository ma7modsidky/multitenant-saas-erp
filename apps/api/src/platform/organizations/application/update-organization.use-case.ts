import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { Organization } from '../domain/index.js';
import { ORGANIZATION_REPOSITORY, type OrganizationRepository } from '../ports/index.js';

/**
 * Input for updating an organization.
 */
export interface UpdateOrganizationInput {
  organizationId: string;
  name?: string;
  countryCode?: string;
  timezone?: string;
  baseCurrency?: string;
  defaultLocale?: string;
  /** Set to true if the org has monetary records that would freeze base_currency (CUR-1) */
  hasMonetaryRecords?: boolean;
}

/**
 * UpdateOrganizationUseCase — updates organization profile fields.
 *
 * Business rules:
 * - CUR-1: Base currency cannot be changed after monetary records exist
 * - Slug is immutable (changing slug would break URL references)
 */
@Injectable()
export class UpdateOrganizationUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly orgRepo: OrganizationRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: UpdateOrganizationInput): Promise<Organization> {
    const orgData = await this.orgRepo.findById(input.organizationId);

    if (!orgData) {
      throw new NotFoundError('ORG_NOT_FOUND', { organizationId: input.organizationId });
    }

    const organization = Organization.fromPersistence(orgData);

    // Check base currency immutability (CUR-1)
    if (input.baseCurrency && input.baseCurrency !== organization.baseCurrency) {
      organization.assertBaseCurrencyMutable(input.hasMonetaryRecords ?? false);
    }

    // Apply updates — filter undefined values
    const updates: Record<string, string | undefined> = {
      name: input.name,
      countryCode: input.countryCode,
      timezone: input.timezone,
      baseCurrency: input.baseCurrency,
      defaultLocale: input.defaultLocale,
    };

    // Remove undefined entries to satisfy exactOptionalPropertyTypes
    const definedUpdates: Record<string, string> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        definedUpdates[key] = value;
      }
    }

    organization.updateProfile(definedUpdates);

    const updated = await this.txManager.run(async (tx) => {
      const persisted = await this.orgRepo.update(input.organizationId, organization.toJSON(), tx);
      if (!persisted) {
        throw new NotFoundError('ORG_NOT_FOUND', { organizationId: input.organizationId });
      }
      return Organization.fromPersistence(persisted);
    });

    return updated;
  }
}
