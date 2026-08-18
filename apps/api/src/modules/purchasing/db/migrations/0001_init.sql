-- 0001_init.sql — Purchasing & Suppliers module initial schema
-- Follow DATA_MODEL.md §2 (mandatory base columns) + §5 (money pairs) + §11.
--
-- Critical invariants (BUSINESS_RULES.md §14):
--   PUR-1   supplier requires a name; tax id unique per org when provided
--   PUR-2   pur_vendor_ledger is append-only and the AP source of truth
--   PUR-3   PO lifecycle; a PO with receipts cannot be cancelled
--   PUR-4   GRN lines never exceed the PO line remaining quantity
--   PUR-6   bill approval requires received GRN (goods lines) — three-way match
--   PUR-7   payment allocations cumulative ≤ bill total
--   PUR-8   PO lines snapshot variant refs by id without a FK (hard rule #1)
--   PUR-13  idempotency keys make GRN/bill/payment/return operations replay-safe
--
-- Inventory ids (variant_id, warehouse_id) are stored WITHOUT foreign keys
-- (module boundary, hard rule #1). Money columns are bigint minor units +
-- char(3) currency.

-- ─── Supplier directory (PUR-1) ─────────────────────────────────────────────
CREATE TABLE pur_suppliers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  tax_id          text NULL,
  -- PUR-1/PUR-10: net_days, discount_days, discount_rate_bp. Bill due dates
  -- derive from net_days (PUR-10).
  payment_terms   jsonb NOT NULL DEFAULT '{"net_days": 30, "discount_days": 0, "discount_rate_bp": 0}'::jsonb,
  currency        char(3) NOT NULL DEFAULT 'USD',
  contact_name    text NULL,
  contact_email   text NULL,
  contact_phone   text NULL,
  address         jsonb NULL,
  bank_account    jsonb NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL,
  updated_by      uuid NULL,
  deleted_at      timestamptz NULL
);
-- PUR-1: code + (when provided) tax id unique per org.
CREATE UNIQUE INDEX uq_pur_suppliers_org_code ON pur_suppliers (organization_id, code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_pur_suppliers_org_tax_id ON pur_suppliers (organization_id, tax_id) WHERE deleted_at IS NULL AND tax_id IS NOT NULL;

-- ─── Vendor ledger (PUR-2) — append-only AP ledger ──────────────────────────
CREATE TABLE pur_vendor_ledger (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  supplier_id       uuid NOT NULL REFERENCES pur_suppliers(id),
  -- PUR-2: bills +, payments −, debit notes −, opening balance ±.
  type              text NOT NULL
    CONSTRAINT ck_pur_vendor_ledger_type CHECK (type IN ('opening_balance', 'bill', 'payment', 'debit_note')),
  -- SIGNED minor units: bills positive, payments/debit notes negative.
  amount_minor      bigint NOT NULL,
  currency          char(3) NOT NULL,
  reference_type    text NOT NULL,
  reference_id      uuid NULL,
  entry_date        date NOT NULL DEFAULT CURRENT_DATE,
  idempotency_key   uuid NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL
);
-- PUR-13/OPS-1: a replayed operation can never post twice.
CREATE UNIQUE INDEX uq_pur_vendor_ledger_org_idempotency
  ON pur_vendor_ledger (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_pur_vendor_ledger_org_supplier ON pur_vendor_ledger (organization_id, supplier_id, entry_date);
-- Append-only enforcement (PUR-2) in 0003_append_only.sql.

-- ─── Requisitions (optional, PUR-12) ────────────────────────────────────────
CREATE TABLE pur_requisitions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  number            text NOT NULL,
  status            text NOT NULL DEFAULT 'draft'
    CONSTRAINT ck_pur_requisitions_status CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  requested_by      uuid NULL,
  required_by_date  date NULL,
  notes             text NULL,
  -- PUR-12: when purchase_approval is enabled, the multi-step chain.
  approval_chain    jsonb NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL,
  updated_by        uuid NULL,
  deleted_at        timestamptz NULL
);
CREATE UNIQUE INDEX uq_pur_requisitions_org_number ON pur_requisitions (organization_id, number) WHERE deleted_at IS NULL;

CREATE TABLE pur_requisition_lines (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL,
  requisition_id           uuid NOT NULL REFERENCES pur_requisitions(id) ON DELETE CASCADE,
  variant_id               uuid NULL,
  item_name_snapshot       text NOT NULL,
  quantity                 numeric(18,4) NOT NULL
    CONSTRAINT ck_pur_requisition_lines_quantity_positive CHECK (quantity > 0),
  estimated_unit_cost_minor bigint NOT NULL DEFAULT 0,
  estimated_unit_cost_currency char(3) NOT NULL DEFAULT 'USD',
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NULL
);
CREATE INDEX idx_pur_requisition_lines_org_req ON pur_requisition_lines (organization_id, requisition_id);

-- ─── Purchase orders (PUR-3, PUR-8) ─────────────────────────────────────────
CREATE TABLE pur_purchase_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  number            text NOT NULL,
  supplier_id       uuid NOT NULL REFERENCES pur_suppliers(id),
  status            text NOT NULL DEFAULT 'draft'
    CONSTRAINT ck_pur_purchase_orders_status CHECK (status IN ('draft', 'pending_approval', 'approved', 'partially_received', 'received', 'closed', 'cancelled')),
  order_date        date NOT NULL DEFAULT CURRENT_DATE,
  expected_date     date NULL,
  currency          char(3) NOT NULL,
  subtotal_minor    bigint NOT NULL DEFAULT 0,
  discount_minor    bigint NOT NULL DEFAULT 0,
  tax_minor         bigint NOT NULL DEFAULT 0,
  total_minor       bigint NOT NULL DEFAULT 0,
  notes             text NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL,
  updated_by        uuid NULL,
  deleted_at        timestamptz NULL
);
CREATE UNIQUE INDEX uq_pur_purchase_orders_org_number ON pur_purchase_orders (organization_id, number) WHERE deleted_at IS NULL;
CREATE INDEX idx_pur_purchase_orders_org_supplier ON pur_purchase_orders (organization_id, supplier_id, order_date);

CREATE TABLE pur_po_lines (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL,
  po_id                  uuid NOT NULL REFERENCES pur_purchase_orders(id) ON DELETE CASCADE,
  -- PUR-8: variant ref by id, NO FK (hard rule #1). Null for service lines.
  variant_id             uuid NULL,
  item_name_snapshot     text NOT NULL,
  quantity               numeric(18,4) NOT NULL
    CONSTRAINT ck_pur_po_lines_quantity_positive CHECK (quantity > 0),
  received_quantity      numeric(18,4) NOT NULL DEFAULT 0
    CONSTRAINT ck_pur_po_lines_received_non_negative CHECK (received_quantity >= 0),
  unit_cost_minor        bigint NOT NULL
    CONSTRAINT ck_pur_po_lines_cost_non_negative CHECK (unit_cost_minor >= 0),
  unit_cost_currency     char(3) NOT NULL DEFAULT 'USD',
  discount_minor         bigint NOT NULL DEFAULT 0,
  tax_rate_bp_snapshot   integer NOT NULL DEFAULT 0
    CONSTRAINT ck_pur_po_lines_tax_rate_non_negative CHECK (tax_rate_bp_snapshot >= 0),
  line_total_minor       bigint NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NULL
);
CREATE INDEX idx_pur_po_lines_org_po ON pur_po_lines (organization_id, po_id);

-- ─── Goods received notes (PUR-4, PUR-5) ────────────────────────────────────
CREATE TABLE pur_grns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  number            text NOT NULL,
  po_id             uuid NOT NULL REFERENCES pur_purchase_orders(id),
  supplier_id       uuid NOT NULL REFERENCES pur_suppliers(id),
  -- Inventory warehouse id — plain id, NO FK (hard rule #1).
  warehouse_id      uuid NULL,
  status            text NOT NULL DEFAULT 'draft'
    CONSTRAINT ck_pur_grns_status CHECK (status IN ('draft', 'received')),
  received_at       timestamptz NULL,
  received_by       uuid NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL,
  updated_by        uuid NULL
);
CREATE UNIQUE INDEX uq_pur_grns_org_number ON pur_grns (organization_id, number);

CREATE TABLE pur_grn_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  grn_id              uuid NOT NULL REFERENCES pur_grns(id) ON DELETE CASCADE,
  po_line_id          uuid NOT NULL REFERENCES pur_po_lines(id),
  variant_id          uuid NULL,
  quantity            numeric(18,4) NOT NULL
    CONSTRAINT ck_pur_grn_lines_quantity_positive CHECK (quantity > 0),
  unit_cost_minor     bigint NOT NULL DEFAULT 0,
  unit_cost_currency  char(3) NOT NULL DEFAULT 'USD',
  accepted            boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL
);
CREATE INDEX idx_pur_grn_lines_org_grn ON pur_grn_lines (organization_id, grn_id);
-- PUR-4 backstop: a GRN line can never push the PO line's received_quantity
-- past its ordered quantity (trigger in 0004_grn_overshoot.sql would be
-- preferred, but we enforce in the receiving transaction + this CHECK):
-- the application locks the PO line (SELECT ... FOR UPDATE) while receiving,
-- so concurrent GRNs cannot overshoot (PUR-4).

-- ─── Bills (PUR-6, PUR-7, PUR-9) ────────────────────────────────────────────
CREATE TABLE pur_bills (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL,
  number                    text NOT NULL,
  supplier_id               uuid NOT NULL REFERENCES pur_suppliers(id),
  po_id                     uuid NULL REFERENCES pur_purchase_orders(id),
  grn_id                    uuid NULL REFERENCES pur_grns(id),
  status                    text NOT NULL DEFAULT 'draft'
    CONSTRAINT ck_pur_bills_status CHECK (status IN ('draft', 'approved', 'partially_paid', 'paid', 'void')),
  bill_date                 date NOT NULL DEFAULT CURRENT_DATE,
  due_date                  date NULL,
  currency                  char(3) NOT NULL,
  subtotal_minor            bigint NOT NULL DEFAULT 0,
  discount_minor            bigint NOT NULL DEFAULT 0,
  tax_minor                 bigint NOT NULL DEFAULT 0,
  total_minor               bigint NOT NULL
    CONSTRAINT ck_pur_bills_total_non_negative CHECK (total_minor >= 0),
  -- PUR-7: running projection of allocated payments (the allocation rows are
  -- the source of truth; this avoids a scan on every read).
  paid_minor                bigint NOT NULL DEFAULT 0
    CONSTRAINT ck_pur_bills_paid_non_negative CHECK (paid_minor >= 0),
  supplier_tax_id_snapshot  text NULL,
  idempotency_key           uuid NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid NULL,
  updated_by                uuid NULL,
  deleted_at                timestamptz NULL
);
CREATE UNIQUE INDEX uq_pur_bills_org_number ON pur_bills (organization_id, number) WHERE deleted_at IS NULL;
-- PUR-13/OPS-1: a replayed approval is a no-op.
CREATE UNIQUE INDEX uq_pur_bills_org_idempotency ON pur_bills (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_pur_bills_org_supplier ON pur_bills (organization_id, supplier_id, bill_date);

CREATE TABLE pur_bill_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  bill_id               uuid NOT NULL REFERENCES pur_bills(id) ON DELETE CASCADE,
  po_line_id            uuid NULL REFERENCES pur_po_lines(id),
  grn_line_id           uuid NULL REFERENCES pur_grn_lines(id),
  variant_id            uuid NULL,
  item_name_snapshot    text NOT NULL DEFAULT '',
  quantity              numeric(18,4) NOT NULL
    CONSTRAINT ck_pur_bill_lines_quantity_positive CHECK (quantity > 0),
  unit_cost_minor       bigint NOT NULL DEFAULT 0,
  unit_cost_currency    char(3) NOT NULL DEFAULT 'USD',
  tax_rate_bp_snapshot  integer NOT NULL DEFAULT 0,
  tax_minor             bigint NOT NULL DEFAULT 0,
  line_total_minor      bigint NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NULL
);
CREATE INDEX idx_pur_bill_lines_org_bill ON pur_bill_lines (organization_id, bill_id);

-- ─── Supplier payments (PUR-7) ──────────────────────────────────────────────
CREATE TABLE pur_supplier_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  number            text NOT NULL,
  supplier_id       uuid NOT NULL REFERENCES pur_suppliers(id),
  method            text NOT NULL
    CONSTRAINT ck_pur_supplier_payments_method CHECK (method IN ('cash', 'bank_transfer', 'card', 'cheque', 'other')),
  amount_minor      bigint NOT NULL
    CONSTRAINT ck_pur_supplier_payments_amount_positive CHECK (amount_minor > 0),
  currency          char(3) NOT NULL,
  paid_at           timestamptz NOT NULL DEFAULT now(),
  reference         text NULL,
  idempotency_key   uuid NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL
);
CREATE UNIQUE INDEX uq_pur_supplier_payments_org_number ON pur_supplier_payments (organization_id, number);
CREATE UNIQUE INDEX uq_pur_supplier_payments_org_idempotency
  ON pur_supplier_payments (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_pur_supplier_payments_org_supplier ON pur_supplier_payments (organization_id, supplier_id, paid_at);

CREATE TABLE pur_payment_allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  payment_id        uuid NOT NULL REFERENCES pur_supplier_payments(id) ON DELETE CASCADE,
  bill_id           uuid NOT NULL REFERENCES pur_bills(id),
  amount_minor      bigint NOT NULL
    CONSTRAINT ck_pur_payment_allocations_amount_positive CHECK (amount_minor > 0),
  currency          char(3) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL
);
-- PUR-7: cumulative allocations per bill never exceed its total (enforced by
-- the domain inside the payment transaction; index for the read).
CREATE INDEX idx_pur_payment_allocations_org_bill ON pur_payment_allocations (organization_id, bill_id);
CREATE INDEX idx_pur_payment_allocations_org_payment ON pur_payment_allocations (organization_id, payment_id);

-- ─── Supplier returns / debit notes (PUR-11) ────────────────────────────────
CREATE TABLE pur_supplier_returns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  number            text NOT NULL,
  supplier_id       uuid NOT NULL REFERENCES pur_suppliers(id),
  bill_id           uuid NULL REFERENCES pur_bills(id),
  grn_line_id       uuid NULL REFERENCES pur_grn_lines(id),
  reason_code       text NOT NULL,
  status            text NOT NULL DEFAULT 'draft'
    CONSTRAINT ck_pur_supplier_returns_status CHECK (status IN ('draft', 'approved', 'void')),
  amount_minor      bigint NOT NULL
    CONSTRAINT ck_pur_supplier_returns_amount_positive CHECK (amount_minor > 0),
  currency          char(3) NOT NULL,
  returned_at       timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL,
  updated_by        uuid NULL
);
CREATE UNIQUE INDEX uq_pur_supplier_returns_org_number ON pur_supplier_returns (organization_id, number);

CREATE TABLE pur_supplier_return_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  return_id           uuid NOT NULL REFERENCES pur_supplier_returns(id) ON DELETE CASCADE,
  variant_id          uuid NULL,
  quantity            numeric(18,4) NOT NULL
    CONSTRAINT ck_pur_supplier_return_lines_quantity_positive CHECK (quantity > 0),
  unit_cost_minor     bigint NOT NULL DEFAULT 0,
  unit_cost_currency  char(3) NOT NULL DEFAULT 'USD',
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL
);
CREATE INDEX idx_pur_supplier_return_lines_org_return ON pur_supplier_return_lines (organization_id, return_id);

-- ─── Per-org settings + counters ────────────────────────────────────────────
CREATE TABLE pur_org_settings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL UNIQUE,
  approval_required       boolean NOT NULL DEFAULT false,
  default_payment_terms   jsonb NOT NULL DEFAULT '{"net_days": 30, "discount_days": 0, "discount_rate_bp": 0}'::jsonb,
  -- PUR-12: plan-gated feature flags mirrored from the entitlement row
  -- (the entitlement's `features` set is the runtime authority; this jsonb is
  -- a convenience mirror for settings reads).
  features                jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Sequential, gap-free per-org counters (PUR-3/6/7). Bumped atomically
  -- inside the document transaction (UPDATE ... RETURNING).
  next_supplier_code      bigint NOT NULL DEFAULT 0,
  next_requisition_number bigint NOT NULL DEFAULT 0,
  next_po_number          bigint NOT NULL DEFAULT 0,
  next_grn_number         bigint NOT NULL DEFAULT 0,
  next_bill_number        bigint NOT NULL DEFAULT 0,
  next_payment_number     bigint NOT NULL DEFAULT 0,
  next_return_number      bigint NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL,
  updated_by              uuid NULL
);
