import { Inject, Injectable } from '@nestjs/common';
import type { SearchContributor } from '../ports/index.js';
import { SEARCH_CONTRIBUTORS } from '../ports/index.js';

/**
 * Federated search — queries all registered module contributors in parallel
 * and aggregates results.
 *
 * @see PLAN.md §2.8 — Search
 */
@Injectable()
export class FederatedSearchUseCase {
  constructor(
    @Inject(SEARCH_CONTRIBUTORS)
    private readonly contributors: SearchContributor[],
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

    // Query all contributors in parallel
    const results = await Promise.allSettled(
      this.contributors.map(async (contributor) => {
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
