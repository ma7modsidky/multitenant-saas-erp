import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { ConflictError } from '../../../core/common/errors.js';
import type { TxOrDb } from '../../../core/database/repository.base.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from '../../memberships/ports/index.js';
import { SYSTEM_ROLES } from '../../roles/domain/index.js';
import { ROLE_REPOSITORY, type RoleRepository } from '../../roles/ports/index.js';
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
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: RoleRepository,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: CreateOrganizationInput): Promise<CreateOrganizationOutput> {
    const ctx = TenantContext.getCurrent();
    if (!ctx?.userId) {
      throw new Error('CreateOrganizationUseCase requires an authenticated tenant context');
    }
    const userId = ctx.userId;

    // Validate slug uniqueness
    const slugTaken = await this.orgRepo.isSlugTaken(input.slug);
    if (slugTaken) {
      throw new ConflictError('ORG_SLUG_TAKEN', 'Slug is already taken', { slug: input.slug });
    }

    // The organization id is generated up front so the owner role + membership
    // can be created atomically in the same transaction, scoped to the new org.
    const organizationId = crypto.randomUUID();

    // Bind the transaction to the NEW organization so the RLS-protected
    // core_roles / core_memberships inserts pass WITH CHECK (AUTH-10).
    const organization = await TenantContext.run(
      {
        ...ctx,
        organizationId,
        roles: [SYSTEM_ROLES.OWNER],
        permissions: [],
      },
      async () =>
        this.txManager.run(async (tx) => {
          // Create the organization entity
          const orgData = Organization.create({
            id: organizationId,
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

          // AUTH-10: The creating user becomes the organization's OWNER.
          await this.createOwnerRoleAndMembership(persisted.id, userId, tx);

          return Organization.fromPersistence(persisted);
        }),
    );

    return { organization };
  }

  /**
   * AUTH-10 — create the OWNER system role and an active membership for the
   * creating user, so the org has an administrator from the moment it exists.
   */
  private async createOwnerRoleAndMembership(
    organizationId: string,
    userId: string,
    tx: TxOrDb,
  ): Promise<void> {
    const now = new Date();

    const role = await this.roleRepo.insert({
      id: crypto.randomUUID(),
      organizationId,
      key: SYSTEM_ROLES.OWNER,
      nameI18n: { en: 'Owner', ar: 'المالك', fr: 'Propriétaire', es: 'Propietario' },
      description: 'Organization owner with full administrative access.',
      isSystem: true,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
    }, tx);

    await this.membershipRepo.insert({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      roleId: role.id,
      status: 'active',
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
    }, tx);
  }
}
