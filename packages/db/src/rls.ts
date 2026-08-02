/**
 * RLS (Row-Level Security) helpers.
 *
 * Generates the standard RLS SQL block for tenant-isolated tables.
 * Every tenant-owned table must have this exact policy applied.
 *
 * @see DATA_MODEL.md §2 — The RLS pattern (copy this exactly)
 */

/**
 * Returns the standard RLS SQL for a tenant-isolated table.
 *
 * ```sql
 * ALTER TABLE <tableName> ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE <tableName> FORCE ROW LEVEL SECURITY;
 *
 * CREATE POLICY tenant_isolation ON <tableName>
 *   FOR ALL
 *   TO modubiz_app
 *   USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
 *   WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
 * ```
 *
 * The `NULLIF(..., '')` wrapper is required: PostgreSQL resets custom GUCs to
 * the EMPTY STRING (not NULL) after any transaction touches them, so a policy
 * casting the raw value crashes with `invalid input syntax for type uuid: ""`
 * on the next org-less query for that pooled connection. NULLIF normalizes both
 * unset (NULL) and reset ('') to NULL → fail-closed, zero rows (see 0008).
 */
export function generateRlsPolicy(tableName: string): string {
  return `
ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ${tableName}
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
`.trim();
}

/**
 * Returns the SQL for the `set_updated_at()` trigger function.
 * This function is attached to all tables with an `updated_at` column.
 */
export function generateSetUpdatedAtFunction(): string {
  return `
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
`.trim();
}

/**
 * Returns a SQL statement to attach the `set_updated_at` trigger to a table.
 */
export function generateSetUpdatedAtTrigger(tableName: string): string {
  return `
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON ${tableName}
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
`.trim();
}

/**
 * Returns the SQL to make a table append-only (no UPDATE, no DELETE).
 * Used for ledger tables like `inv_stock_movements`, `core_audit_log`, `pos_payments`.
 */
export function generateAppendOnlyTrigger(tableName: string): string {
  return `
CREATE OR REPLACE FUNCTION prevent_update_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '${tableName} is append-only. No UPDATE or DELETE allowed.'
    USING ERRCODE = '2F002'; -- integrity constraint violation
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_update_delete
  BEFORE UPDATE OR DELETE ON ${tableName}
  FOR EACH ROW
  EXECUTE FUNCTION prevent_update_delete();
`.trim();
}

/**
 * Returns the SQL for mandatory base columns on tenant-owned tables.
 * @see DATA_MODEL.md §3 — Universal column conventions
 */
export const BASE_COLUMNS_SQL = `
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_by      uuid,
  deleted_at      timestamptz
`.trim();
