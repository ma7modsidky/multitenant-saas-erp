-- 0019_org_settings_tax_enabled.sql
-- ACC-11: the organization-wide tax engine switch. When enabled, POS and
-- invoice lines resolve their tax rate from the configured tax-rate catalog
-- (acc_tax_rates) instead of free-form per-line input. Default true: existing
-- orgs keep their tax-computing behaviour.

ALTER TABLE core_organization_settings
  ADD COLUMN tax_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN core_organization_settings.tax_enabled
  IS 'Whether the centralized tax engine resolves tax rates from the tax-rate catalog (ACC-11).';