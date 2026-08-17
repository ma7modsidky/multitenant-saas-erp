-- 0018_org_settings_seller_tax_id.sql
-- ACC-6: the organization's seller/company tax ID (VAT/TRN) used on issued
-- invoices. It is snapshotted onto each invoice at issuance; the org-level
-- value is the default source for new invoices and the display fallback for
-- older invoices issued before the setting existed.

ALTER TABLE core_organization_settings
  ADD COLUMN seller_tax_id text;

COMMENT ON COLUMN core_organization_settings.seller_tax_id
  IS 'The organization''s seller/company tax ID shown on issued invoices (ACC-6).';
