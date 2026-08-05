-- 0002_rls.sql — RLS for inventory tables (DATA_MODEL.md §2)
-- MUST be applied for EVERY tenant table created in 0001.

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON inventory_items
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
