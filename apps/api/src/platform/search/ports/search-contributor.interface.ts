/**
 * A search contributor is registered by each module that participates in
 * the federated search. When a search query is issued, all registered
 * contributors are queried in parallel and results are aggregated.
 *
 * @see PLAN.md §2.8 — Search
 * @see PLAN.md §3.3 — Search contributor registration
 */
export interface SearchContributor {
  /** Module key this contributor belongs to. */
  readonly moduleKey: string;

  /** Human-readable label for the result type (i18n key). */
  readonly labelKey: string;

  /**
   * Execute a search query.
   * @param query - The search text
   * @param organizationId - Current organization context
   * @param limit - Max results per contributor
   */
  search(query: string, organizationId: string, limit: number): Promise<SearchResult[]>;
}

export interface SearchResult {
  /** Unique id within the contributor's scope. */
  id: string;
  /** Display title. */
  title: string;
  /** Optional description / subtitle. */
  description?: string;
  /** URL path to navigate to the result. */
  href: string;
  /** Optional icon identifier. */
  icon?: string;
}

export const SEARCH_CONTRIBUTORS = Symbol('SEARCH_CONTRIBUTORS');
