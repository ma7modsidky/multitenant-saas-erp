import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { BILLING_REPOSITORY, type BillingRepository } from '../../billing/ports/index.js';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from '../../memberships/ports/index.js';
import { ADMIN_DIRECTORY_REPOSITORY, type AdminDirectoryRepository } from '../ports/index.js';

/** Entitlement states that count as an enabled module. */
const ENABLED_STATES = new Set(['active', 'trialing', 'past_due']);

export interface AdminOrgSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  memberCount: number;
  subscriptionStatus: string | null;
  activeModuleCount: number;
}

/**
 * ListOrganizationsUseCase — paginated, searchable organization directory for
 * the admin console. Orgs are read globally; per-org state (members,
 * subscription, entitlements) is aggregated inside runWithOrg (PLT-3).
 */
@Injectable()
export class ListOrganizationsUseCase {
  constructor(
    @Inject(ADMIN_DIRECTORY_REPOSITORY)
    private readonly directoryRepo: AdminDirectoryRepository,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    @Inject(BILLING_REPOSITORY)
    private readonly billingRepo: BillingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: {
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: AdminOrgSummary[]; total: number; page: number; pageSize: number }> {
    // Guard against NaN from `Number(queryParam)` in the controller — NaN
    // would flow into `LIMIT NaN` and 500. Fall back to defaults.
    const page = Number.isFinite(input.page) ? Math.max(input.page ?? 1, 1) : 1;
    const pageSize = Number.isFinite(input.pageSize) ? Math.min(Math.max(input.pageSize ?? 20, 1), 100) : 20;
    const search = input.search?.trim() || undefined;

    const [orgs, total] = await Promise.all([
      this.directoryRepo.listOrgs(search, pageSize, (page - 1) * pageSize),
      this.directoryRepo.countOrgs(search),
    ]);

    const items = await Promise.all(
      orgs.map(async (org): Promise<AdminOrgSummary> => {
        const [memberCount, subscription, entitlements] = await this.txManager.runWithOrg(org.id, async (tx) => {
          const [members, sub, ents] = await Promise.all([
            this.membershipRepo.countActiveByOrgId(org.id, tx),
            this.billingRepo.findByOrgId(org.id, tx),
            this.billingRepo.findEntitlementsByOrg(org.id, tx),
          ]);
          return [members, sub, ents] as const;
        });

        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          status: org.status,
          createdAt: org.createdAt.toISOString(),
          memberCount,
          subscriptionStatus: subscription?.status ?? null,
          activeModuleCount: entitlements.filter((e) => ENABLED_STATES.has(e.state)).length,
        };
      }),
    );

    return { items, total, page, pageSize };
  }
}
