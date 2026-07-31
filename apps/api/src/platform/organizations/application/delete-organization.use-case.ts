import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { Organization } from '../domain/index.js';
import { ORGANIZATION_REPOSITORY, type OrganizationRepository } from '../ports/index.js';

/**
 * Input for soft-deleting an organization.
 */
export interface DeleteOrganizationInput {
  organizationId: string;
}

/**
 * DeleteOrganizationUseCase — initiates soft-delete with 30-day grace period.
 *
 * Business rules:
 * - GDPR-2: Deleting an organization starts a 30-day pending_deletion grace period
 * - Only OWNER can delete (enforced by controller guard)
 * - Suspended organizations cannot be deleted
 */
@Injectable()
export class DeleteOrganizationUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly orgRepo: OrganizationRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: DeleteOrganizationInput): Promise<{ deletionScheduledAt: Date }> {
    const orgData = await this.orgRepo.findById(input.organizationId);

    if (!orgData) {
      throw new NotFoundError('ORG_NOT_FOUND', { organizationId: input.organizationId });
    }

    const organization = Organization.fromPersistence(orgData);

    // Schedule deletion (enforces GDPR-2 invariants; throws OrganizationError on violation)
    organization.scheduleDeletion();

    const updated = await this.txManager.run(async (tx) => {
      const persisted = await this.orgRepo.update(input.organizationId, organization.toJSON(), tx);
      if (!persisted) {
        throw new NotFoundError('ORG_NOT_FOUND', { organizationId: input.organizationId });
      }
      return Organization.fromPersistence(persisted);
    });

    return { deletionScheduledAt: updated.deletionScheduledAt! };
  }
}

/**
 * CancelDeletionUseCase — cancels a pending deletion and restores the organization.
 *
 * Business rules:
 * - GDPR-2: Cancellation restores the org to active within the grace period
 */
@Injectable()
export class CancelDeletionUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly orgRepo: OrganizationRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: DeleteOrganizationInput): Promise<Organization> {
    const orgData = await this.orgRepo.findById(input.organizationId);

    if (!orgData) {
      throw new NotFoundError('ORG_NOT_FOUND', { organizationId: input.organizationId });
    }

    const organization = Organization.fromPersistence(orgData);

    // Cancel deletion (enforces GDPR-2 invariants; throws OrganizationError on violation)
    organization.cancelDeletion();

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
