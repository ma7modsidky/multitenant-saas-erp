import { validateDescriptors, type ModuleDescriptor } from '@modubiz/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { MODULE_BOOT_VALIDATION_FAILED } from '../domain/index.js';
import { type ModuleRegistryRepository, MODULE_REGISTRY_REPOSITORY } from '../ports/index.js';
import { REGISTERED_MODULES } from '../registered-modules.js';

/**
 * Service that validates module descriptors at boot time.
 *
 * Validation rules:
 * 1. All `dependsOn` keys reference a registered module.
 * 2. No two modules share a permission key.
 * 3. No two modules share an event name (for publishes).
 * 4. No two modules share a table prefix.
 * 5. Consumed events are published by a registered module.
 * 6. No two modules provide the same port token.
 * 7. Consumed ports are provided by a registered module.
 *
 * @see PLAN.md §2.7 — Module registry
 */
@Injectable()
export class BootValidationService {
  private readonly logger = new Logger(BootValidationService.name);

  constructor(
    @Inject(MODULE_REGISTRY_REPOSITORY)
    private readonly repo: ModuleRegistryRepository,
  ) {}

  async validateAndSync(): Promise<void> {
    const descriptors = REGISTERED_MODULES;

    // Shared cross-descriptor validation lives in @modubiz/contracts so the
    // error codes (DESCRIPTOR_ERROR) are stable and identical between the
    // validation logic, this boot service, and the unit tests (PLAN §3.1, §3.3).
    const validationErrors = validateDescriptors(descriptors);

    if (validationErrors.length > 0) {
      const message = `Module registry boot validation failed:\n${validationErrors
        .map((e) => `  - ${e.message} (${e.code})`)
        .join('\n')}`;
      this.logger.error(message);
      throw new Error(`${MODULE_BOOT_VALIDATION_FAILED}: ${message}`);
    }

    this.logger.log(
      `Boot validation passed for ${descriptors.length} module(s): ${descriptors.map((d) => d.key).join(', ')}`,
    );

    // Sync descriptors to database tables
    await this.syncToDatabase(descriptors);
  }

  private async syncToDatabase(descriptors: ModuleDescriptor[]): Promise<void> {
    const registeredKeys = descriptors.map((d) => d.key);

    for (const d of descriptors) {
      await this.repo.upsertModule({
        key: d.key,
        version: d.version,
        name: d.nameKey,
        description: d.descriptionKey,
        icon: d.icon ?? null,
        dependsOn: d.dependsOn,
        tablePrefix: d.tablePrefix,
        stripePriceKey: d.stripePriceKey,
        trialDays: d.trialDays,
      });

      for (const perm of d.permissions) {
        await this.repo.upsertPermission(perm, d.key, null);
      }
    }

    // The catalog is mirrored from descriptors at boot, so a true mirror must
    // also remove entries for modules that are no longer registered. Without
    // this, a module removed from registered-modules.ts keeps appearing in the
    // marketplace (GET /v1/modules reads core_module_catalog) — see the demo
    // module cleanup in Phase 3.
    const { removed, kept } = await this.repo.pruneStaleModules(registeredKeys);
    if (removed.length > 0) {
      this.logger.warn(
        `Pruned ${removed.length} stale catalog entr${removed.length === 1 ? 'y' : 'ies'} no longer registered: ${removed.join(', ')}`,
      );
    }
    if (kept.length > 0) {
      this.logger.warn(
        `Kept ${kept.length} catalog entr${kept.length === 1 ? 'y' : 'ies'} still referenced by a dependent row (entitlement or role permission): ${kept.join(', ')}`,
      );
    }

    this.logger.log(`Synced ${descriptors.length} module(s) and their permissions to the database.`);
  }
}
