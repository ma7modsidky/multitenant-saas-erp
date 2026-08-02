import { Inject, Injectable } from '@nestjs/common';

import { MODULE_REGISTRY_REPOSITORY, type ModuleRegistryRepository } from '../ports/index.js';

/**
 * List all registered modules from the catalog.
 * Used for the public catalog endpoint (GET /modules).
 *
 * @see PLAN.md §2.7 — GET /modules
 */
@Injectable()
export class ListModulesUseCase {
  constructor(
    @Inject(MODULE_REGISTRY_REPOSITORY)
    private readonly repo: ModuleRegistryRepository,
  ) {}

  async execute(): Promise<
    Array<{
      key: string;
      nameKey: string;
      descriptionKey: string | null;
      icon: string | null;
      dependsOn: string[];
      trialDays: number;
      permissions: string[];
    }>
  > {
    const modules = await this.repo.listModules();

    // Map catalog data to descriptor shape
    return modules.map((m) => ({
      key: m.key,
      nameKey: m.name,
      descriptionKey: m.description,
      icon: m.icon,
      dependsOn: m.dependsOn,
      trialDays: m.trialDays,
      permissions: [],
    }));
  }
}
