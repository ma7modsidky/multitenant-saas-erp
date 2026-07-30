/**
 * Pagination input parameters for list endpoints.
 *
 * Supports both offset-based and cursor-based pagination.
 * Cursor pagination is preferred for large, dynamic datasets.
 *
 * @example
 * ```typescript
 * // Offset-based
 * { limit: 20, offset: 0, sortBy: 'name', sortOrder: 'asc' }
 *
 * // Cursor-based
 * { limit: 20, cursor: 'eyJsYXN0X2lkIjogIjEyMyJ9' }
 * ```
 */
export interface PaginationInput {
  /** Maximum number of items to return. Clamped to max 100. */
  limit: number;
  /** Offset from the start (offset-based pagination). Defaults to 0. */
  offset?: number;
  /** Opaque cursor for cursor-based pagination. */
  cursor?: string;
  /** Column to sort by. */
  sortBy?: string;
  /** Sort direction. Defaults to 'asc'. */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Pagination metadata attached to paginated responses.
 */
export interface PaginationMeta {
  /** Total number of items matching the query (without pagination). */
  total: number;
  /** Whether there are more items beyond this page. */
  hasMore: boolean;
  /** Next cursor for cursor-based pagination (if applicable). */
  nextCursor?: string;
}

/**
 * Paginated response wrapper.
 *
 * @typeParam T - The item type
 */
export interface PaginatedResponse<T> {
  /** Array of items for the current page. */
  items: T[];
  /** Pagination metadata. */
  meta: PaginationMeta;
}

/** Maximum allowed pagination limit */
export const MAX_PAGINATION_LIMIT = 100;

/** Default pagination limit */
export const DEFAULT_PAGINATION_LIMIT = 20;

/**
 * Clamp the pagination limit to a safe maximum.
 * Prevents abuse and ensures predictable server load.
 *
 * @param limit - The requested limit
 * @param max - The maximum allowed limit (defaults to 100)
 * @returns The clamped limit, minimum 1
 */
export function clampLimit(limit: number, max = MAX_PAGINATION_LIMIT): number {
  return Math.max(1, Math.min(limit, max));
}

/**
 * Build pagination metadata from a query result.
 *
 * @param items - The items returned for this page
 * @param total - Total matching items count
 * @param limit - The page limit used
 * @param offset - The offset used (for computing hasMore)
 * @returns PaginationMeta object
 */
export function buildPaginationMeta<T>(
  items: T[],
  total: number,
  limit: number,
  offset = 0,
): PaginationMeta {
  return {
    total,
    hasMore: offset + limit < total,
  };
}

/**
 * Parse and normalize pagination input from query parameters.
 * Provides safe defaults for every field.
 *
 * Uses conditional spread to handle optional fields correctly with
 * exactOptionalPropertyTypes (omits undefined keys instead of
 * setting them to undefined).
 *
 * @param input - Raw pagination input (from query params)
 * @returns Normalized PaginationInput with safe defaults
 */
export function normalizePagination(
  input: Partial<PaginationInput>,
): PaginationInput {
  return {
    limit: clampLimit(input.limit ?? DEFAULT_PAGINATION_LIMIT),
    offset: Math.max(0, input.offset ?? 0),
    sortOrder: input.sortOrder ?? 'asc',
    // Conditionally include optional fields to satisfy exactOptionalPropertyTypes
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    ...(input.sortBy !== undefined ? { sortBy: input.sortBy } : {}),
  } as PaginationInput;
}
