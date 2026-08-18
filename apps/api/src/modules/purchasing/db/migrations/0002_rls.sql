-- 0002_rls.sql — RLS for Purchasing tables (DATA_MODEL.md §2)
-- The standard tenant_isolation block, copied exactly, for EVERY tenant table
-- created in 0001_init.sql. No exceptions, no variations.

-- pur_suppliers
ALTER TABLE pur_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_suppliers
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_vendor_ledger
ALTER TABLE pur_vendor_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_vendor_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_vendor_ledger
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_requisitions
ALTER TABLE pur_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_requisitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_requisitions
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_requisition_lines
ALTER TABLE pur_requisition_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_requisition_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_requisition_lines
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_purchase_orders
ALTER TABLE pur_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_purchase_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_purchase_orders
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_po_lines
ALTER TABLE pur_po_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_po_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_po_lines
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_grns
ALTER TABLE pur_grns ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_grns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_grns
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_grn_lines
ALTER TABLE pur_grn_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_grn_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_grn_lines
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_bills
ALTER TABLE pur_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_bills FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_bills
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_bill_lines
ALTER TABLE pur_bill_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_bill_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_bill_lines
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_supplier_payments
ALTER TABLE pur_supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_supplier_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_supplier_payments
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_payment_allocations
ALTER TABLE pur_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_payment_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_payment_allocations
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_supplier_returns
ALTER TABLE pur_supplier_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_supplier_returns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_supplier_returns
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_supplier_return_lines
ALTER TABLE pur_supplier_return_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_supplier_return_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_supplier_return_lines
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- pur_org_settings
ALTER TABLE pur_org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pur_org_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pur_org_settings
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
