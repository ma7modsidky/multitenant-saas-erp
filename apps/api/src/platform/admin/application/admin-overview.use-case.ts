import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { BILLING_REPOSITORY, type BillingRepository } from '../../billing/ports/index.js';
import { ADMIN_DIRECTORY_REPOSITORY, type AdminDirectoryRepository } from '../ports/index.js';

/** Entitlement states that count as an enabled module. */
const ENABLED_STATES = new Set(['active', 'trialing', 'past_due']);

/**
 * AdminOverviewUseCase — platform-wide headline stats for the admin console.
 *
 * Global tables (core_organizations, core_users) are read directly; per-org
 * subscription/entitlement state is RLS-protected, so it is aggregated one
 * organization at a time inside `TransactionManager.runWithOrg` (PLT-3) —
 * never via an unscoped cross-tenant scan.
 */
@Injectable()
export class AdminOverviewUseCase {
  constructor(
    @Inject(ADMIN_DIRECTORY_REPOSITORY)
    private readonly directoryRepo: AdminDirectoryRepository,
    @Inject(BILLING_REPOSITORY)
    private readonly billingRepo: BillingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(): Promise<{
    organizations: { total: number; active: number; pendingDeletion: number };
    totalUsers: number;
    subscriptions: { active: number; other: number };
    modulesEnabledByKey: Record<string, number>;
  }> {
    const [totalOrgs, totalUsers, allOrgs] = await Promise.all([
      this.directoryRepo.countOrgs(undefined),
      this.directoryRepo.countUsers(),
      this.directoryRepo.listOrgs(undefined, 1000, 0),
    ]);

    const active = allOrgs.filter((o) => o.status === 'active').length;
    const pendingDeletion = allOrgs.filter((o) => o.status === 'pending_deletion').length;

    const modulesEnabledByKey: Record<string, number> = {};
    let activeSubscriptions = 0;
    let otherSubscriptions = 0;

    // Per-org state must be read inside an org-bound transaction (PLT-3).
    for (const org of allOrgs) {
      const [subscription, entitlements] = await this.txManager.runWithOrg(org.id, async (tx) => {
        const [sub, ents] = await Promise.all([
          this.billingRepo.findByOrgId(org.id, tx),
          this.billingRepo.findEntitlementsByOrg(org.id, tx),
        ]);
        return [sub, ents] as const;
      });

      if (subscription?.status === 'active') activeSubscriptions += 1;
      else if (subscription) otherSubscriptions += 1;

      for (const ent of entitlements) {
        if (ENABLED_STATES.has(ent.state)) {
          modulesEnabledByKey[ent.moduleKey] = (modulesEnabledByKey[ent.moduleKey] ?? 0) + 1;
        }
      }
    }

    return {
      organizations: { total: totalOrgs, active, pendingDeletion },
      totalUsers,
      subscriptions: { active: activeSubscriptions, other: otherSubscriptions },
      modulesEnabledByKey,
    };
  }
}
