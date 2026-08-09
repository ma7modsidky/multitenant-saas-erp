-- 0001_init.sql — POS module initial schema
-- Follow DATA_MODEL.md §2 (mandatory base columns) + §5 (money pairs) + §9.
--
-- Critical invariants (BUSINESS_RULES.md §7):
--   POS-1   a register is bound to exactly one warehouse (warehouse_id, no FK)
--   POS-2   at most one open shift per register (partial unique index)
--   POS-9   receipt numbers sequential + gap-free per register (unique receipt)
--   POS-11  one currency per sale (single currency column)
--   POS-12  line snapshots (sku_snapshot / name_snapshot / prices)
--   POS-16  totals and discounts never negative (check constraints)
--   POS-22  restock flag per refund line
--   POS-26  UNIQUE (organization_id, idempotency_key) on pos_sales
-- Append-only payments ledger (`pos_payments`) lives in 0003_append_only.sql.
-- Inventory / CRM ids are stored WITHOUT foreign keys (module boundary).

CREATE TABLE pos_registers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  name                text NOT NULL,
  code                text NOT NULL,
  -- POS-1: exactly one warehouse; Inventory id, NO FK (module boundary).
  warehouse_id        uuid NOT NULL,
  receipt_prefix      text NOT NULL DEFAULT 'R',
  -- POS-9: atomic allocation via UPDATE ... RETURNING next_receipt_number + 1.
  next_receipt_number bigint NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL,
  updated_by          uuid NULL,
  deleted_at          timestamptz NULL
);
CREATE UNIQUE INDEX uq_pos_registers_org_code ON pos_registers (organization_id, code) WHERE deleted_at IS NULL;

CREATE TABLE pos_shifts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL,
  register_id                 uuid NOT NULL,
  -- POS-4: the operator and the opening float are recorded at open.
  opened_by                   uuid NOT NULL,
  opened_at                   timestamptz NOT NULL DEFAULT now(),
  opening_float_amount_minor  bigint NOT NULL DEFAULT 0
    CONSTRAINT ck_pos_shifts_float_non_negative CHECK (opening_float_amount_minor >= 0),
  closed_by                   uuid NULL,
  closed_at                   timestamptz NULL,
  counted_cash_amount_minor   bigint NULL,
  expected_cash_amount_minor  bigint NULL,
  variance_amount_minor       bigint NULL,
  currency                    char(3) NOT NULL,
  status                      text NOT NULL DEFAULT 'open'
    CONSTRAINT ck_pos_shifts_status CHECK (status IN ('open', 'closed')),
  -- POS-7: manager force-close with unsynced offline sales in the outbox.
  forced_close                boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NULL,
  updated_by                  uuid NULL
);
-- POS-2: at most one open shift per register, enforced by the database.
CREATE UNIQUE INDEX uq_pos_shifts_open ON pos_shifts (organization_id, register_id) WHERE status = 'open';

CREATE TABLE pos_sales (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL,
  shift_id                uuid NOT NULL,
  register_id             uuid NOT NULL,
  -- POS-9: the full receipt string (prefix + number), unique per register.
  receipt_number          text NOT NULL,
  -- POS-18: optional CRM contact link — plain id, NO FK.
  customer_contact_id     uuid NULL,
  status                  text NOT NULL DEFAULT 'completed'
    CONSTRAINT ck_pos_sales_status CHECK (status IN ('completed', 'refunded', 'partially_refunded', 'voided')),
  subtotal_amount_minor   bigint NOT NULL DEFAULT 0,
  discount_amount_minor   bigint NOT NULL DEFAULT 0,
  tax_amount_minor        bigint NOT NULL DEFAULT 0,
  -- POS-16: no negative totals.
  total_amount_minor      bigint NOT NULL
    CONSTRAINT ck_pos_sales_total_non_negative CHECK (total_amount_minor >= 0),
  currency                char(3) NOT NULL,
  -- FX snapshot when the sale currency differs from the org base currency.
  exchange_rate           numeric(20,10) NULL,
  base_total_amount_minor bigint NULL,
  -- POS-19: locale used, so the receipt regenerates identically.
  locale                  text NOT NULL DEFAULT 'en',
  -- POS-26: offline sync idempotency (client-generated UUID).
  idempotency_key         uuid NULL,
  sold_at                 timestamptz NOT NULL DEFAULT now(),
  -- NULL while an offline sale awaits sync (POS-27); online sales are synced
  -- at creation.
  synced_at               timestamptz NULL,
  client_device_id        text NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL,
  updated_by              uuid NULL
);
-- POS-9: receipt numbers sequential + gap-free per register.
CREATE UNIQUE INDEX uq_pos_sales_org_receipt ON pos_sales (organization_id, register_id, receipt_number);
-- POS-26: a retried offline sale can never create a duplicate.
CREATE UNIQUE INDEX uq_pos_sales_org_idempotency ON pos_sales (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_pos_sales_org_shift ON pos_sales (organization_id, shift_id, sold_at);

CREATE TABLE pos_sale_lines (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL,
  sale_id                     uuid NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  -- Inventory variant id, NO FK — POS-12 snapshots keep history if it changes.
  variant_id                  uuid NOT NULL,
  -- POS-12: snapshot the SKU and name so a historical receipt is reproducible.
  sku_snapshot                text NOT NULL,
  name_snapshot               jsonb NOT NULL DEFAULT '{}'::jsonb,
  quantity                    numeric(18,4) NOT NULL
    CONSTRAINT ck_pos_sale_lines_quantity_positive CHECK (quantity > 0),
  unit_price_amount_minor     bigint NOT NULL
    CONSTRAINT ck_pos_sale_lines_price_non_negative CHECK (unit_price_amount_minor >= 0),
  line_discount_amount_minor  bigint NOT NULL DEFAULT 0
    CONSTRAINT ck_pos_sale_lines_discount_non_negative CHECK (line_discount_amount_minor >= 0),
  tax_rate_bp                 integer NOT NULL DEFAULT 0
    CONSTRAINT ck_pos_sale_lines_tax_rate_non_negative CHECK (tax_rate_bp >= 0),
  tax_amount_minor            bigint NOT NULL DEFAULT 0,
  line_total_amount_minor     bigint NOT NULL
    CONSTRAINT ck_pos_sale_lines_total_non_negative CHECK (line_total_amount_minor >= 0),
  currency                    char(3) NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid NULL
);
CREATE INDEX idx_pos_sale_lines_org_sale ON pos_sale_lines (organization_id, sale_id);

-- Append-only payment records (POS-10: sum(payments) = total; corrections are
-- refunds, never edits). UPDATE/DELETE blocked by 0003_append_only.sql.
CREATE TABLE pos_payments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL,
  sale_id                uuid NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE,
  method                 text NOT NULL
    CONSTRAINT ck_pos_payments_method CHECK (method IN ('cash', 'card', 'other')),
  amount_minor           bigint NOT NULL
    CONSTRAINT ck_pos_payments_amount_non_negative CHECK (amount_minor >= 0),
  currency               char(3) NOT NULL,
  tendered_amount_minor  bigint NULL,
  change_amount_minor    bigint NOT NULL DEFAULT 0,
  reference              text NULL,
  captured_at            timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NULL
);
CREATE INDEX idx_pos_payments_org_sale ON pos_payments (organization_id, sale_id);

CREATE TABLE pos_refunds (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  -- POS-20: refund references the original completed sale.
  original_sale_id  uuid NOT NULL REFERENCES pos_sales(id),
  shift_id          uuid NOT NULL,
  register_id       uuid NOT NULL,
  -- POS-23: a refund requires a reason code.
  reason_code       text NOT NULL,
  amount_minor      bigint NOT NULL
    CONSTRAINT ck_pos_refunds_amount_non_negative CHECK (amount_minor >= 0),
  currency          char(3) NOT NULL,
  refunded_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL
);
CREATE INDEX idx_pos_refunds_org_sale ON pos_refunds (organization_id, original_sale_id);

CREATE TABLE pos_refund_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  refund_id         uuid NOT NULL REFERENCES pos_refunds(id) ON DELETE CASCADE,
  -- The ORIGINAL sale line being refunded (POS-21 tracks per-line quantity).
  sale_line_id      uuid NOT NULL REFERENCES pos_sale_lines(id),
  variant_id        uuid NOT NULL,
  quantity          numeric(18,4) NOT NULL
    CONSTRAINT ck_pos_refund_lines_quantity_positive CHECK (quantity > 0),
  -- POS-22: restock is decided per line (return vs write_off movement).
  restock           boolean NOT NULL DEFAULT true,
  amount_minor      bigint NOT NULL
    CONSTRAINT ck_pos_refund_lines_amount_non_negative CHECK (amount_minor >= 0),
  currency          char(3) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL
);
CREATE INDEX idx_pos_refund_lines_org_refund ON pos_refund_lines (organization_id, refund_id);

-- POS-29: every offline sync attempt is recorded with its outcome.
CREATE TABLE pos_sync_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  client_device_id  text NOT NULL,
  idempotency_key   uuid NOT NULL,
  payload           jsonb NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  result            text NOT NULL
    CONSTRAINT ck_pos_sync_log_result CHECK (result IN ('accepted', 'duplicate', 'rejected')),
  error_code        text NULL
);
CREATE INDEX idx_pos_sync_log_org_key ON pos_sync_log (organization_id, idempotency_key);
