import type { ModuleDescriptor } from '@modubiz/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  MODULE_DEPENDENCY_MISSING,
  MODULE_DUPLICATE_PERMISSION,
  MODULE_DUPLICATE_EVENT,
  MODULE_DUPLICATE_TABLE_PREFIX,
} from '../domain/index.js';
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
    const errors: string[] = [];
    const keys = new Set<string>();

    // Build module key index
    for (const d of descriptors) {
      keys.add(d.key);
    }

    // Check dependencies
    for (const d of descriptors) {
      for (const dep of d.dependsOn) {
        if (!keys.has(dep)) {
          errors.push(
            `Module "${d.key}" depends on "${dep}" which is not registered. (${MODULE_DEPENDENCY_MISSING})`,
          );
        }
      }
    }

    // Check duplicate table prefixes
    const tablePrefixes = new Map<string, string>();
    for (const d of descriptors) {
      const existing = tablePrefixes.get(d.tablePrefix);
      if (existing) {
        errors.push(
          `Table prefix "${d.tablePrefix}" is used by modules "${existing}" and "${d.key}". (${MODULE_DUPLICATE_TABLE_PREFIX})`,
        );
      }
      tablePrefixes.set(d.tablePrefix, d.key);
    }

    // Check duplicate permission keys across modules
    const permissionMap = new Map<string, string>();
    for (const d of descriptors) {
      for (const perm of d.permissions) {
        const existing = permissionMap.get(perm);
        if (existing) {
          errors.push(
            `Permission "${perm}" is declared by modules "${existing}" and "${d.key}". (${MODULE_DUPLICATE_PERMISSION})`,
          );
        }
        permissionMap.set(perm, d.key);
      }
    }

    // Check duplicate published event names across modules
    const eventMap = new Map<string, string>();
    for (const d of descriptors) {
      for (const event of d.publishes) {
        const existing = eventMap.get(event);
        if (existing) {
          errors.push(
            `Event "${event}" is published by modules "${existing}" and "${d.key}". (${MODULE_DUPLICATE_EVENT})`,
          );
        }
        eventMap.set(event, d.key);
      }
    }

    // Validate consumed events are published by a registered module
    for (const d of descriptors) {
      for (const event of d.consumes) {
        if (!eventMap.has(event)) {
          errors.push(
            `Module "${d.key}" consumes event "${event}" which is not published by any registered module. (${MODULE_DEPENDENCY_MISSING})`,
          );
        }
      }
    }

    if (errors.length > 0) {
      const message = `Module registry boot validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`;
      this.logger.error(message);
      throw new Error(message);
    }

    this.logger.log(`Boot validation passed for ${descriptors.length} module(s): ${[...keys].join(', ')}`);

    // Sync descriptors to database tables
    await this.syncToDatabase(descriptors);
  }

  private async syncToDatabase(descriptors: ModuleDescriptor[]): Promise<void> {
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

    this.logger.log(`Synced ${descriptors.length} module(s) and their permissions to the database.`);
  }
}
