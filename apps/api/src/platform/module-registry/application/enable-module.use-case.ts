import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError, ForbiddenError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { MODULE_NOT_FOUND, MODULE_ALREADY_ENABLED, MODULE_DEPENDENCY_NOT_ENTITLED } from '../domain/index.js';
import { MODULE_REGISTRY_REPOSITORY, type ModuleRegistryRepository } from '../ports/index.js';
import { REGISTERED_MODULES } from '../registered-modules.js';

/**
 * Enable a module for an organization.
 * Validates dependencies (BILL-8) — all dependsOn modules must be entitled.
 *
 * @see PLAN.md §2.7 — Enable/disable
 * @see BUSINESS_RULES.md — BILL-8
 */
@Injectable()
export class EnableModuleUseCase {
  constructor(
    @Inject(MODULE_REGISTRY_REPOSITORY)
    private readonly repo: ModuleRegistryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { organizationId: string; moduleKey: string; updatedBy: string }): Promise<void> {
    // Verify the module exists in the catalog
    const descriptor = REGISTERED_MODULES.find((m) => m.key === input.moduleKey);
    if (!descriptor) {
      throw new NotFoundError(MODULE_NOT_FOUND, { moduleKey: input.moduleKey });
    }

    await this.txManager.run(async (tx) => {
      // Check current entitlement state
      const existing = await this.repo.getEntitlement(input.organizationId, input.moduleKey, tx);

      if (existing && !['available', 'disabled', 'expired'].includes(existing.state)) {
        throw new ConflictError(
          MODULE_ALREADY_ENABLED,
          `Module "${input.moduleKey}" is already in state "${existing.state}".`,
        );
      }

      // BILL-8: Check dependencies are entitled
      for (const dep of descriptor.dependsOn) {
        const depEntitlement = await this.repo.getEntitlement(input.organizationId, dep, tx);
        if (!depEntitlement || !['active', 'trialing', 'past_due'].includes(depEntitlement.state)) {
          throw new ForbiddenError(
            MODULE_DEPENDENCY_NOT_ENTITLED,
            `Cannot enable "${input.moduleKey}": dependency "${dep}" is not entitled.`,
          );
        }
      }

      // Set entitlement to active
      await this.repo.updateEntitlementState(input.organizationId, input.moduleKey, 'active', input.updatedBy, tx);
    });
  }
}
