-- 0005_return_tax.sql
-- PUR-11 + ACC-11: supplier returns now carry tax, mirroring the bill model.
--   pur_supplier_returns.amount_minor stays the NET returned value
--   (Σ quantity × unit cost) for backward compatibility; subtotal_minor is its
--   alias and total_minor = amount_minor + tax_minor (the gross AP reduction).
--   supplier_tax_id_snapshot carries the supplier's tax id from the source bill.
--   pur_supplier_return_lines gain per-line tax snapshots so the GL can reverse
--   the input-VAT leg exactly (Cr Input VAT 2200).
-- New columns only; existing approved returns keep tax 0.

ALTER TABLE pur_supplier_returns
  ADD COLUMN subtotal_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN tax_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN total_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN supplier_tax_id_snapshot text NULL;

COMMENT ON COLUMN pur_supplier_returns.subtotal_minor
  IS 'Net returned value = Σ quantity × unit cost (alias of amount_minor) — PUR-11.';
COMMENT ON COLUMN pur_supplier_returns.tax_minor
  IS 'Return tax = Σ line taxes; total_minor = amount_minor + tax_minor — ACC-11.';
COMMENT ON COLUMN pur_supplier_returns.total_minor
  IS 'Gross AP reduction for the return (net + tax) — ACC-11.';

ALTER TABLE pur_supplier_return_lines
  ADD COLUMN tax_rate_bp_snapshot integer NOT NULL DEFAULT 0
    CONSTRAINT ck_pur_supplier_return_lines_tax_rate_non_negative CHECK (tax_rate_bp_snapshot >= 0),
  ADD COLUMN tax_amount_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN line_total_minor bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN pur_supplier_return_lines.tax_rate_bp_snapshot
  IS 'Tax rate snapshot inherited from the referenced bill line (ACC-11).';
COMMENT ON COLUMN pur_supplier_return_lines.tax_amount_minor
  IS 'Per-line tax = round(line net × rateBp / 10000) (ACC-11).';