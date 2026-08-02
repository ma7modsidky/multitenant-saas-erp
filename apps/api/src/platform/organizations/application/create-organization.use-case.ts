import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { ConflictError } from '../../../core/common/errors.js';
import type { TxOrDb } from '../../../core/database/repository.base.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from '../../memberships/ports/index.js';
import { SYSTEM_ROLES, SYSTEM_ROLE_SEED, type SystemRoleKey } from '../../roles/domain/index.js';
import { ROLE_REPOSITORY, type RoleRepository } from '../../roles/ports/index.js';
import { Organization, defaultOrganizationSettings } from '../domain/index.js';
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
          // The full system-role set (owner, admin, manager, member, viewer)
          // is seeded so every org starts with the documented role matrix
          // (BUSINESS_RULES.md §3) — the members/invite dropdowns read these
          // rows.
          await this.createSystemRolesAndOwnerMembership(persisted.id, userId, tx);

          return Organization.fromPersistence(persisted);
        }),
    );

    return { organization };
  }

  /**
   * AUTH-10 — seed the five system roles (OWNER, ADMIN, MANAGER, MEMBER,
   * VIEWER) and create an active OWNER membership for the creating user, so
   * the org has an administrator — and the full role matrix — from the
   * moment it exists.
   *
   * System-role *permissions* are code-defined (SYSTEM_ROLE_PERMISSIONS and
   * the role-matrix endpoint); only the role rows are persisted per org.
   */
  private async createSystemRolesAndOwnerMembership(organizationId: string, userId: string, tx: TxOrDb): Promise<void> {
    const now = new Date();
    let ownerRoleId: string | undefined;

    for (const key of Object.values(SYSTEM_ROLES) as SystemRoleKey[]) {
      const seed = SYSTEM_ROLE_SEED[key];
      const role = await this.roleRepo.insert(
        {
          id: crypto.randomUUID(),
          organizationId,
          key,
          nameI18n: seed.nameI18n,
          description: seed.description,
          isSystem: true,
          createdAt: now,
          updatedAt: now,
          createdBy: userId,
          updatedBy: userId,
          deletedAt: null,
        },
        tx,
      );

      if (key === SYSTEM_ROLES.OWNER) ownerRoleId = role.id;
    }

    if (!ownerRoleId) {
      throw new Error('OWNER system role must be seeded for a new organization');
    }

    await this.membershipRepo.insert(
      {
        id: crypto.randomUUID(),
        organizationId,
        userId,
        roleId: ownerRoleId,
        status: 'active',
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
      },
      tx,
    );
  }
}
