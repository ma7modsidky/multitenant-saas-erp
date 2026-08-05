import { type SearchContributor, type SearchResult } from '@modubiz/contracts';

/**
 * Federated-search contributor for the inventory module.
 * Registered by the composition root when searchContributor: true.
 *
 * @see ARCHITECTURE.md §6 — Federated search
 */
export class InventorySearchContributor implements SearchContributor {
  readonly moduleKey = 'inventory';
  readonly labelKey = 'modules.inventory.name';

  async search(_query: string, _organizationId: string, _limit: number): Promise<SearchResult[]> {
    return [];
  }
}
