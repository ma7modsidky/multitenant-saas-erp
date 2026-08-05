-- 0002_rls.sql — RLS for inventory tables (DATA_MODEL.md §2)
-- The standard tenant_isolation block, copied exactly, for EVERY tenant table
-- created in 0001_init.sql.

-- inv_categories
ALTER TABLE inv_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv_categories
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- inv_units_of_measure
ALTER TABLE inv_units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_units_of_measure FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv_units_of_measure
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- inv_products
ALTER TABLE inv_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_products FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv_products
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- inv_product_variants
ALTER TABLE inv_product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_product_variants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv_product_variants
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- inv_warehouses
ALTER TABLE inv_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_warehouses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv_warehouses
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- inv_stock_levels
ALTER TABLE inv_stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_stock_levels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv_stock_levels
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- inv_stock_movements
ALTER TABLE inv_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv_stock_movements
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- inv_stock_reservations
ALTER TABLE inv_stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_stock_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv_stock_reservations
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- inv_stock_counts
ALTER TABLE inv_stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_stock_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv_stock_counts
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- inv_stock_count_lines
ALTER TABLE inv_stock_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_stock_count_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv_stock_count_lines
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- inv_low_stock_alerts
ALTER TABLE inv_low_stock_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_low_stock_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inv_low_stock_alerts
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
