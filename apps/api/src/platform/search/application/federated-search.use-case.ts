import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { MODULE_REGISTRY_REPOSITORY, type ModuleRegistryRepository } from '../../module-registry/ports/index.js';

import type { SearchContributor } from '../ports/index.js';
import { SEARCH_CONTRIBUTORS } from '../ports/index.js';

/** Entitlement states that grant access, matching navigation + dashboard widgets. */
const ACTIVE_ENTITLEMENT_STATES = new Set(['active', 'trialing', 'past_due']);

/**
 * Federated search — queries all registered module contributors in parallel
 * and aggregates results, restricted to modules the organization is entitled
 * to (same authority as navigation and dashboard widgets).
 *
 * @see PLAN.md §2.8 — Search
 */
@Injectable()
export class FederatedSearchUseCase {
  constructor(
    @Inject(SEARCH_CONTRIBUTORS)
    private readonly contributors: SearchContributor[],
    @Inject(MODULE_REGISTRY_REPOSITORY)
    private readonly moduleRepo: ModuleRegistryRepository,
    private readonly tx: TransactionManager,
  ) {}

  async execute(input: { query: string; organizationId: string; limit?: number }): Promise<
    Array<{
      moduleKey: string;
      labelKey: string;
      results: Array<{ id: string; title: string; description?: string; href: string; icon?: string }>;
    }>
  > {
    const limitPerContributor = Math.min(input.limit ?? 5, 20);
    const trimmedQuery = input.query.trim();

    if (!trimmedQuery || trimmedQuery.length < 2) {
      return [];
    }

    // core_module_entitlements is RLS-protected — read inside the tenant-bound
    // transaction or it fails closed to zero rows. A contributor whose module
    // is not entitled (e.g. a trial that was disabled) must not surface data
    // or deep links the organization can no longer open.
    const entitlements = await this.tx.run((db) => this.moduleRepo.listEntitlements(input.organizationId, db));
    const entitledKeys = new Set(
      entitlements.filter((e) => ACTIVE_ENTITLEMENT_STATES.has(e.state)).map((e) => e.moduleKey),
    );
    const eligible = this.contributors.filter((c) => entitledKeys.has(c.moduleKey));
    if (eligible.length === 0) {
      return [];
    }

    // Query all entitled contributors in parallel
    const results = await Promise.allSettled(
      eligible.map(async (contributor) => {
        const items = await contributor.search(trimmedQuery, input.organizationId, limitPerContributor);
        return {
          moduleKey: contributor.moduleKey,
          labelKey: contributor.labelKey,
          results: items,
        };
      }),
    );

    // Collect successful results, log failures (non-blocking)
    const aggregated: Array<{
      moduleKey: string;
      labelKey: string;
      results: Array<{ id: string; title: string; description?: string; href: string; icon?: string }>;
    }> = [];

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.results.length > 0) {
        aggregated.push(result.value);
      }
      // Failures are silently skipped — a broken contributor shouldn't crash search
    }

    return aggregated;
  }
}
