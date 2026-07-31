import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { MODULE_NOT_FOUND, MODULE_HAS_DEPENDENTS } from '../domain/index.js';
import { MODULE_REGISTRY_REPOSITORY, type ModuleRegistryRepository } from '../ports/index.js';
import { REGISTERED_MODULES } from '../registered-modules.js';

/**
 * Disable a module for an organization.
 * Guards against disabling modules that other entitled modules depend on (BILL-9).
 *
 * @see PLAN.md §2.7 — Enable/disable
 * @see BUSINESS_RULES.md — BILL-9
 */
@Injectable()
export class DisableModuleUseCase {
  constructor(
    @Inject(MODULE_REGISTRY_REPOSITORY)
    private readonly repo: ModuleRegistryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: {
    organizationId: string;
    moduleKey: string;
    updatedBy: string;
  }): Promise<void> {
    // Verify the module exists
    const descriptor = REGISTERED_MODULES.find((m) => m.key === input.moduleKey);
    if (!descriptor) {
      throw new NotFoundError(MODULE_NOT_FOUND, { moduleKey: input.moduleKey });
    }

    await this.txManager.run(async (tx) => {
      // BILL-9: Check no entitled modules depend on this one
      const dependents = await this.repo.getDependentModules(input.moduleKey, tx);
      const entitledDependents: string[] = [];

      for (const dep of dependents) {
        const ent = await this.repo.getEntitlement(input.organizationId, dep, tx);
        if (ent && ['active', 'trialing', 'past_due'].includes(ent.state)) {
          entitledDependents.push(dep);
        }
      }

      if (entitledDependents.length > 0) {
        throw new ConflictError(
          MODULE_HAS_DEPENDENTS,
          `Cannot disable "${input.moduleKey}": modules [${entitledDependents.join(', ')}] depend on it.`,
        );
      }

      // Set entitlement to disabled
      await this.repo.updateEntitlementState(
        input.organizationId,
        input.moduleKey,
        'disabled',
        input.updatedBy,
        tx,
      );
    });
  }
}
