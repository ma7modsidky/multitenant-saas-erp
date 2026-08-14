import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { BILLING_REPOSITORY, type BillingRepository } from '../../billing/ports/index.js';
import { MEMBERSHIP_REPOSITORY, type MembershipRepository } from '../../memberships/ports/index.js';
import { MODULE_REGISTRY_REPOSITORY, type ModuleRegistryRepository } from '../../module-registry/ports/index.js';
import { ADMIN_DIRECTORY_REPOSITORY, type AdminDirectoryRepository } from '../ports/index.js';

/**
 * GetOrganizationDetailUseCase — full admin view of one organization:
 * profile, members, subscription, and entitlements with module display names.
 * Orgs are global; tenant-scoped reads run inside runWithOrg (PLT-3).
 */
@Injectable()
export class GetOrganizationDetailUseCase {
  constructor(
    @Inject(ADMIN_DIRECTORY_REPOSITORY)
    private readonly directoryRepo: AdminDirectoryRepository,
    @Inject(MEMBERSHIP_REPOSITORY)
    private readonly membershipRepo: MembershipRepository,
    @Inject(BILLING_REPOSITORY)
    private readonly billingRepo: BillingRepository,
    @Inject(MODULE_REGISTRY_REPOSITORY)
    private readonly moduleRegistryRepo: ModuleRegistryRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { organizationId: string }): Promise<{
    organization: {
      id: string;
      name: string;
      slug: string;
      status: string;
      createdAt: string;
    };
    members: Array<{ id: string; name: string; email: string; roleId: string }>;
    subscription: {
      id: string;
      status: string;
      billingCurrency: string;
      currentPeriodEnd: string | null;
    } | null;
    entitlements: Array<{
      moduleKey: string;
      moduleName: string;
      state: string;
      trialEndsAt: string | null;
      activatedAt: string | null;
      disabledAt: string | null;
    }>;
  }> {
    const org = await this.directoryRepo.findOrgById(input.organizationId);
    if (!org) {
      throw new NotFoundError('ORG_NOT_FOUND', { organizationId: input.organizationId });
    }

    const [members, subscription, entitlementRows] = await this.txManager.runWithOrg(
      input.organizationId,
      async (tx) => {
        const [m, sub, ents] = await Promise.all([
          this.membershipRepo.findMembersByOrgId(input.organizationId, tx),
          this.billingRepo.findByOrgId(input.organizationId, tx),
          this.billingRepo.findEntitlementsByOrg(input.organizationId, tx),
        ]);
        return [m, sub, ents] as const;
      },
    );

    const catalog = await this.moduleRegistryRepo.listModules();
    const nameByKey = new Map(catalog.map((m) => [m.key, m.name]));

    const entitlements = await Promise.all(
      entitlementRows.map(async (e) => {
        const detail = await this.txManager.runWithOrg(input.organizationId, (tx) =>
          this.billingRepo.findEntitlement(input.organizationId, e.moduleKey, tx),
        );
        return {
          moduleKey: e.moduleKey,
          moduleName: nameByKey.get(e.moduleKey) ?? e.moduleKey,
          state: e.state,
          trialEndsAt: detail?.trialEndsAt?.toISOString() ?? null,
          activatedAt: detail?.activatedAt?.toISOString() ?? null,
          disabledAt: detail?.disabledAt?.toISOString() ?? null,
        };
      }),
    );

    return {
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        createdAt: org.createdAt.toISOString(),
      },
      members: members.map((m) => ({
        id: m.id,
        name: m.userName,
        email: m.userEmail,
        roleId: m.roleId,
      })),
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            billingCurrency: subscription.billingCurrency,
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
          }
        : null,
      entitlements,
    };
  }
}
