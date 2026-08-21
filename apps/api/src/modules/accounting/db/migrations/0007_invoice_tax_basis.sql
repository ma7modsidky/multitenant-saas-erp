-- 0007_invoice_tax_basis.sql
-- ACC-11: invoice lines snapshot the tax rate's basis so the document and GL
-- stay correct even if the rate later changes. Existing rows (POS sales,
-- inclusive pricing) are 'exclusive' by construction — the POS engine always
-- prices exclusive today.

ALTER TABLE acc_invoice_lines
  ADD COLUMN tax_basis_snapshot text NOT NULL DEFAULT 'exclusive'
    CONSTRAINT ck_acc_invoice_lines_tax_basis CHECK (tax_basis_snapshot IN ('exclusive', 'inclusive'));

COMMENT ON COLUMN acc_invoice_lines.tax_basis_snapshot
  IS 'Snapshot of the rate''s basis at issue time (ACC-11); DEFAULT exclusive for legacy rows.';