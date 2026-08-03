import { type SearchContributor, type SearchResult } from '@modubiz/contracts';

/**
 * Federated-search contributor for the crm module.
 * Registered by the composition root when searchContributor: true.
 *
 * @see ARCHITECTURE.md §6 — Federated search
 */
export class CrmSearchContributor implements SearchContributor {
  readonly moduleKey = 'crm';
  readonly labelKey = 'modules.crm.name';

  async search(_query: string, _organizationId: string, _limit: number): Promise<SearchResult[]> {
    return [];
  }
}
