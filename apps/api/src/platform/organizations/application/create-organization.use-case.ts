import { Inject, Injectable } from '@nestjs/common';

import { ConflictError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import {
  Organization,
  defaultOrganizationSettings,
} from '../domain/index.js';
import { ORGANIZATION_REPOSITORY, type OrganizationRepository } from '../ports/index.js';

/**
 * Input for creating a new organization.
 */
export interface CreateOrganizationInput {
  name: string;
  slug: string;
  countryCode: string;
  timezone?: string;
  baseCurrency: string;
  defaultLocale?: string;
}

/**
 * Result of creating a new organization.
 */
export interface CreateOrganizationOutput {
  organization: Organization;
}

/**
 * CreateOrganizationUseCase — creates a new organization.
 *
 * Business rules:
 * - AUTH-10: The creating user becomes the organization's OWNER (enforced by membership creation)
 * - The slug must be unique (case-insensitive)
 * - Default settings are created for the new organization
 *
 * NOTE: The complete signup flow (create user → create org → create membership)
 * will be wired in the signup use case (Phase 2.3). This use case handles only
 * the org creation part.
 */
@Injectable()
export class CreateOrganizationUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly orgRepo: OrganizationRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: CreateOrganizationInput): Promise<CreateOrganizationOutput> {
    // Validate slug uniqueness
    const slugTaken = await this.orgRepo.isSlugTaken(input.slug);
    if (slugTaken) {
      throw new ConflictError('ORG_SLUG_TAKEN', 'Slug is already taken', { slug: input.slug });
    }

    const organization = await this.txManager.run(async (tx) => {
      // Create the organization entity
      const orgData = Organization.create({
        id: crypto.randomUUID(),
        name: input.name,
        slug: input.slug.toLowerCase().trim(),
        countryCode: input.countryCode.toUpperCase(),
        timezone: input.timezone ?? 'UTC',
        baseCurrency: input.baseCurrency.toUpperCase(),
        defaultLocale: input.defaultLocale ?? 'en',
        status: 'active',
        deletionScheduledAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Persist the organization
      const persisted = await this.orgRepo.insert(orgData.toJSON(), tx);

      // Create default organization settings
      const settings = defaultOrganizationSettings(persisted.id, persisted.baseCurrency);
      await this.orgRepo.upsertSettings(settings, tx);

      return Organization.fromPersistence(persisted);
    });

    return { organization };
  }
}
