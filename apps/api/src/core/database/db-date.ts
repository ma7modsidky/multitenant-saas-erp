/**
 * Date serialization helpers for raw `sql`` templates.
 *
 * Drizzle's postgres-js driver overrides postgres.js date serializers with
 * identity functions (see drizzle-orm/postgres-js/driver.js), so:
 *
 *   - Write side: a raw `Date` bound as a parameter is passed through
 *     unchanged and crashes with `ERR_INVALID_ARG_TYPE` in postgres.js's
 *     `Buffer.byteLength`. Dates must be serialized to ISO strings first.
 *   - Read side: timestamptz values are returned as strings (identity
 *     parser), so they must be normalized back to `Date` instances.
 *
 * Always use these helpers when binding timestamps in raw SQL.
 *
 * @see DATA_MODEL.md §3 — Universal column conventions
 */
export function toDbDate(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString();
}

/**
 * Normalize a raw timestamptz value (string, Date, or null) back to a Date.
 */
export function fromDbDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  return value instanceof Date ? value : new Date(value as string);
}
