import { type SearchContributor, type SearchResult } from '@modubiz/contracts';

/**
 * Federated-search contributor for the accounting module.
 * Registered by the composition root when searchContributor: true.
 *
 * @see ARCHITECTURE.md §6 — Federated search
 */
export class AccountingSearchContributor implements SearchContributor {
  readonly moduleKey = 'accounting';
  readonly labelKey = 'modules.accounting.name';

  async search(_query: string, _organizationId: string, _limit: number): Promise<SearchResult[]> {
    return [];
  }
}
