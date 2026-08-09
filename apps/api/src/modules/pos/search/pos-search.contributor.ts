import { type SearchContributor, type SearchResult } from '@modubiz/contracts';

/**
 * Federated-search contributor for the pos module.
 * Registered by the composition root when searchContributor: true.
 *
 * @see ARCHITECTURE.md §6 — Federated search
 */
export class PosSearchContributor implements SearchContributor {
  readonly moduleKey = 'pos';
  readonly labelKey = 'modules.pos.name';

  async search(_query: string, _organizationId: string, _limit: number): Promise<SearchResult[]> {
    return [];
  }
}
