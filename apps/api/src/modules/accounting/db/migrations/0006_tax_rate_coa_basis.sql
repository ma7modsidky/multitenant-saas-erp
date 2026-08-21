-- 0006_tax_rate_coa_basis.sql
-- ACC-11: extend acc_tax_rates for the centralized tax engine.
--   coa_account_id  — the GL account that absorbs this rate's tax (credits for
--                     sales/AP on invoices; debits for purchases/returns).
--                     Falls back to the seeded VAT accounts (2100 output /
--                     2200 input) when NULL.
--   tax_basis       — exclusive: tax is added on top of the line total;
--                     inclusive: tax is embedded in the line total.
--   is_default      — at most one default rate per org (POS + invoice lines
--                     fall back to it when no rate id is supplied).
-- New columns only; existing rows keep their behaviour (exclusive basis, no
-- COA mapping, not default).

ALTER TABLE acc_tax_rates
  ADD COLUMN coa_account_id uuid NULL
    CONSTRAINT fk_acc_tax_rates_coa_account
      REFERENCES acc_accounts (id) ON DELETE SET NULL,
  ADD COLUMN tax_basis text NOT NULL DEFAULT 'exclusive'
    CONSTRAINT ck_acc_tax_rates_basis CHECK (tax_basis IN ('exclusive', 'inclusive')),
  ADD COLUMN is_default boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN acc_tax_rates.coa_account_id
  IS 'GL account that absorbs this rate''s tax (ACC-11); NULL falls back to the seeded VAT account.';
COMMENT ON COLUMN acc_tax_rates.tax_basis
  IS 'exclusive (tax on top of the line total) or inclusive (tax embedded) — ACC-11.';
COMMENT ON COLUMN acc_tax_rates.is_default
  IS 'At most one default rate per org; lines without a rate id fall back to it (ACC-11).';

-- ACC-11: enforce a single default rate per org (partial unique index allows
-- the all-false state before any default is chosen).
CREATE UNIQUE INDEX uq_acc_tax_rates_one_default
  ON acc_tax_rates (organization_id)
  WHERE is_default AND deleted_at IS NULL;