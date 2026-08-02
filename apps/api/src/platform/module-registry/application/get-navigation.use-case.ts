import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { MODULE_REGISTRY_REPOSITORY, type ModuleRegistryRepository } from '../ports/index.js';
import { REGISTERED_MODULES } from '../registered-modules.js';
import type { NavigationItem } from '@modubiz/contracts';

/**
 * Get navigation items for the current user.
 * Navigation is derived from entitlements + permissions — the UI never hardcodes a module list.
 *
 * @see PLAN.md §2.7 — GET /me/navigation
 */
@Injectable()
export class GetNavigationUseCase {
  constructor(
    @Inject(MODULE_REGISTRY_REPOSITORY)
    private readonly repo: ModuleRegistryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: {
    organizationId: string;
  }): Promise<Array<{ moduleKey: string; labelKey: string; icon?: string; items: NavigationItem[] }>> {
    // core_module_entitlements is RLS-protected — read inside the tenant-bound
    // transaction or it fails closed to zero rows (empty navigation).
    const entitlements = await this.txManager.run((tx) => this.repo.listEntitlements(input.organizationId, tx));
    const entitledKeys = new Set(
      entitlements.filter((e) => ['active', 'trialing', 'past_due'].includes(e.state)).map((e) => e.moduleKey),
    );

    // Build navigation from descriptors of entitled modules
    const result: Array<{ moduleKey: string; labelKey: string; icon?: string; items: NavigationItem[] }> = [];

    for (const descriptor of REGISTERED_MODULES) {
      if (!entitledKeys.has(descriptor.key)) continue;

      const navItem: { moduleKey: string; labelKey: string; icon?: string; items: NavigationItem[] } = {
        moduleKey: descriptor.key,
        labelKey: descriptor.nameKey,
        items: descriptor.navigation,
      };
      if (descriptor.icon) navItem.icon = descriptor.icon;
      result.push(navItem);
    }

    return result;
  }
}
