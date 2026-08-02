/**
 * Search contributor contract — canonical definition lives in
 * `@modubiz/contracts` so business modules can implement it without importing
 * from `platform/` (modules may never import platform code).
 *
 * @see packages/contracts/src/ports/index.ts
 */
export { type SearchContributor, type SearchResult, SEARCH_CONTRIBUTORS } from '@modubiz/contracts';
