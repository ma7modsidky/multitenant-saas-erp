import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { type DashboardWidget } from '@modubiz/contracts';
import { MODULE_REGISTRY_REPOSITORY, type ModuleRegistryRepository } from '../ports/index.js';
import { REGISTERED_MODULES } from '../registered-modules.js';

/**
 * Get dashboard widgets for the current user.
 * Widgets are derived from entitlements + module descriptors — the UI never
 * hardcodes a widget list.
 *
 * @see PLAN.md §3.3 — Dashboard widget registration
 */
@Injectable()
export class GetDashboardWidgetsUseCase {
  constructor(
    @Inject(MODULE_REGISTRY_REPOSITORY)
    private readonly repo: ModuleRegistryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { organizationId: string }): Promise<
    Array<{
      moduleKey: string;
      labelKey: string;
      widgets: Array<DashboardWidget & { icon?: string }>;
    }>
  > {
    // core_module_entitlements is RLS-protected — read inside the tenant-bound
    // transaction or it fails closed to zero rows (empty widget list).
    const entitlements = await this.txManager.run((tx) => this.repo.listEntitlements(input.organizationId, tx));
    const entitledKeys = new Set(
      entitlements.filter((e) => ['active', 'trialing', 'past_due'].includes(e.state)).map((e) => e.moduleKey),
    );

    const result: Array<{
      moduleKey: string;
      labelKey: string;
      widgets: Array<DashboardWidget & { icon?: string }>;
    }> = [];

    for (const descriptor of REGISTERED_MODULES) {
      if (!entitledKeys.has(descriptor.key)) continue;
      if (descriptor.dashboardWidgets.length === 0) continue;

      result.push({
        moduleKey: descriptor.key,
        labelKey: descriptor.nameKey,
        widgets: descriptor.dashboardWidgets.map((widget) =>
          descriptor.icon ? { ...widget, icon: descriptor.icon } : widget,
        ),
      });
    }

    return result;
  }
}
