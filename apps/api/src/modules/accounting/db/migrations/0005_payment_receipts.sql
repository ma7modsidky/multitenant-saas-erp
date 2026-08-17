-- 0005_payment_receipts.sql — structured receipt references for AR payments.
-- ACC-9: every payment carries a human-facing receipt number (REC-000004),
-- allocated from a per-org counter exactly like invoice/credit-note numbers
-- (ACC-3/ACC-10 pattern), so receipts are printable and referenceable.
--
-- The GL receipt entry posted by ApplyPaymentUseCase is keyed on the payment
-- id (source_type 'payment'), so the receipt number is purely presentational.

-- Per-org counter for gap-free receipt numbers.
ALTER TABLE acc_org_settings
  ADD COLUMN next_receipt_number bigint NOT NULL DEFAULT 0;

-- Structured receipt reference on every payment.
ALTER TABLE acc_payments ADD COLUMN receipt_number text;

-- Backfill existing receipts with gap-free numbers per org, in creation order,
-- then advance each org's counter past the highest assigned number. The runner
-- executes as modubiz_owner, so RLS does not apply to this migration.
WITH numbered AS (
  SELECT id, organization_id,
         row_number() OVER (PARTITION BY organization_id ORDER BY created_at, id) AS n
  FROM acc_payments
)
UPDATE acc_payments p
SET receipt_number = 'REC-' || lpad(numbered.n::text, 6, '0')
FROM numbered
WHERE p.id = numbered.id;

UPDATE acc_org_settings s
SET next_receipt_number = COALESCE(m.max_n, 0)
FROM (
  SELECT organization_id, max(cast(substring(receipt_number FROM 5) AS bigint)) AS max_n
  FROM acc_payments
  GROUP BY organization_id
) m
WHERE s.organization_id = m.organization_id;

-- Receipt numbers are unique per org and never null.
ALTER TABLE acc_payments ALTER COLUMN receipt_number SET NOT NULL;
CREATE UNIQUE INDEX uq_acc_payments_org_receipt ON acc_payments (organization_id, receipt_number);
