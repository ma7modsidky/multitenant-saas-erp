-- 0002_rls.sql — RLS for POS tables (DATA_MODEL.md §2)
-- The standard tenant_isolation block, copied exactly, for EVERY tenant table
-- created in 0001_init.sql.

-- pos_registers
ALTER TABLE pos_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_registers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_registers
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pos_shifts
ALTER TABLE pos_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_shifts
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pos_sales
ALTER TABLE pos_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sales FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_sales
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pos_sale_lines
ALTER TABLE pos_sale_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sale_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_sale_lines
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pos_payments
ALTER TABLE pos_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_payments
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pos_refunds
ALTER TABLE pos_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_refunds
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pos_refund_lines
ALTER TABLE pos_refund_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_refund_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_refund_lines
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pos_sync_log
ALTER TABLE pos_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sync_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pos_sync_log
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
