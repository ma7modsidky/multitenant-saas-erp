-- 0002_rls.sql — RLS for Accounting tables (DATA_MODEL.md §2)
-- The standard tenant_isolation block, copied exactly, for EVERY tenant table
-- created in 0001_init.sql. No exceptions, no variations.

-- acc_accounts
ALTER TABLE acc_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acc_accounts
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- acc_tax_rates
ALTER TABLE acc_tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_tax_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acc_tax_rates
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- acc_journal_entries
ALTER TABLE acc_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_journal_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acc_journal_entries
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- acc_journal_lines
ALTER TABLE acc_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_journal_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acc_journal_lines
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- acc_invoices
ALTER TABLE acc_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acc_invoices
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- acc_invoice_lines
ALTER TABLE acc_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_invoice_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acc_invoice_lines
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- acc_payments
ALTER TABLE acc_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acc_payments
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- acc_payment_allocations
ALTER TABLE acc_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_payment_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acc_payment_allocations
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- acc_credit_notes
ALTER TABLE acc_credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_credit_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acc_credit_notes
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- acc_credit_note_lines
ALTER TABLE acc_credit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_credit_note_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acc_credit_note_lines
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- acc_account_balances
ALTER TABLE acc_account_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_account_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acc_account_balances
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- acc_org_settings
ALTER TABLE acc_org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE acc_org_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acc_org_settings
  FOR ALL
  TO modubiz_app
  USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
