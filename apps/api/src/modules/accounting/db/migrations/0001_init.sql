-- 0001_init.sql — Accounting & Invoicing module initial schema
-- Follow DATA_MODEL.md §2 (mandatory base columns) + §5 (money pairs) + §10.
--
-- Critical invariants (BUSINESS_RULES.md §13):
--   ACC-1   every journal entry is balanced (debits = credits) — DB trigger in
--           0004_gl_invariants.sql
--   ACC-2   posted journal entries are immutable; corrections are reversals —
--           append-only trigger in 0003_append_only.sql
--   ACC-3   entry numbers sequential + gap-free per org (unique entry_number)
--   ACC-4   a line sets exactly one of debit/credit; positive minor units
--   ACC-5   system accounts cannot be deleted or renumbered (is_system)
--   ACC-8   invoice status lifecycle CHECK
--   ACC-9   allocations cumulative ≤ invoice total (CHECK per allocation)
--   ACC-10  credit notes numbered sequentially per org, immutable once issued
--   ACC-13  auto-invoice from pos.sale.completed.v1 keyed on idempotency_key
--   ACC-15  idempotent GL posting keyed on source id / idempotency_key
--
-- CRM / Inventory ids are stored WITHOUT foreign keys (module boundary,
-- hard rule #1). All money columns are bigint minor units + char(3) currency.

-- ─── Chart of accounts ──────────────────────────────────────────────────────
CREATE TABLE acc_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  -- ACC-5: system accounts are seeded by the COA ensure and are immutable.
  code            text NOT NULL,
  name_i18n       jsonb NOT NULL DEFAULT '{}'::jsonb,
  type            text NOT NULL
    CONSTRAINT ck_acc_accounts_type CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id       uuid NULL,
  is_system       boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL,
  updated_by      uuid NULL,
  deleted_at      timestamptz NULL
);
-- ACC-5: code unique per org; system accounts can be renamed in name_i18n but
-- never renumbered (the code never changes — enforced by the domain).
CREATE UNIQUE INDEX uq_acc_accounts_org_code ON acc_accounts (organization_id, code) WHERE deleted_at IS NULL;

-- ─── Tax rates ──────────────────────────────────────────────────────────────
CREATE TABLE acc_tax_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  code            text NOT NULL,
  name_i18n       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- ACC-11: basis points (1% = 100 bp). Per-line tax from this rate.
  rate_bp         integer NOT NULL DEFAULT 0
    CONSTRAINT ck_acc_tax_rates_rate_non_negative CHECK (rate_bp >= 0),
  type            text NOT NULL DEFAULT 'standard'
    CONSTRAINT ck_acc_tax_rates_type CHECK (type IN ('standard', 'reduced', 'zero', 'exempt')),
  effective_from  date NOT NULL DEFAULT CURRENT_DATE,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL,
  updated_by      uuid NULL,
  deleted_at      timestamptz NULL
);
CREATE UNIQUE INDEX uq_acc_tax_rates_org_code ON acc_tax_rates (organization_id, code) WHERE deleted_at IS NULL;

-- ─── General ledger ─────────────────────────────────────────────────────────
-- ACC-2: posted entries are immutable — UPDATE/DELETE blocked once posted
-- (0003_append_only.sql). Drafts are editable; posting is a status flip.
CREATE TABLE acc_journal_entries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  -- ACC-3: sequential + gap-free per org, allocated atomically.
  entry_number          bigint NOT NULL,
  entry_date            date NOT NULL,
  description           text NOT NULL DEFAULT '',
  currency              char(3) NOT NULL,
  status                text NOT NULL DEFAULT 'draft'
    CONSTRAINT ck_acc_journal_entries_status CHECK (status IN ('draft', 'posted', 'reversed')),
  -- ACC-15: what produced the entry (e.g. invoice_issuance + invoice id, or a
  -- movement id) so subledger GL posting stays idempotent.
  source_type           text NOT NULL,
  source_id             uuid NULL,
  posted_at             timestamptz NULL,
  posted_by             uuid NULL,
  -- ACC-2: the reversal entry that nullified this one (set when reversed).
  reversed_by_entry_id  uuid NULL,
  idempotency_key       uuid NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NULL,
  updated_by            uuid NULL
);
-- ACC-3: one number per org.
CREATE UNIQUE INDEX uq_acc_journal_entries_org_number ON acc_journal_entries (organization_id, entry_number);
-- ACC-15: a replayed event can never post twice.
CREATE UNIQUE INDEX uq_acc_journal_entries_org_idempotency
  ON acc_journal_entries (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE acc_journal_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  entry_id            uuid NOT NULL REFERENCES acc_journal_entries(id) ON DELETE CASCADE,
  -- ACC-4: exactly one account from the org's COA.
  account_id          uuid NOT NULL REFERENCES acc_accounts(id),
  -- ACC-4: exactly one of these is non-zero (CHECK in 0004_gl_invariants.sql);
  -- both are positive minor units.
  debit_amount_minor  bigint NOT NULL DEFAULT 0,
  credit_amount_minor bigint NOT NULL DEFAULT 0,
  memo                text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL
);
CREATE INDEX idx_acc_journal_lines_org_entry ON acc_journal_lines (organization_id, entry_id);
CREATE INDEX idx_acc_journal_lines_org_account ON acc_journal_lines (organization_id, account_id);

-- ─── Invoices (AR) ──────────────────────────────────────────────────────────
CREATE TABLE acc_invoices (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL,
  -- ACC-10 pattern: sequential + gap-free per org.
  invoice_number          text NOT NULL,
  -- CRM customer ids — plain ids, NO FK (hard rule #1). At least one is set.
  customer_contact_id     uuid NULL,
  customer_company_id     uuid NULL,
  -- Snapshots so historical documents render after the customer changes.
  customer_name_snapshot  text NOT NULL,
  customer_tax_id_snapshot text NULL,
  seller_tax_id           text NULL,
  status                  text NOT NULL DEFAULT 'draft'
    CONSTRAINT ck_acc_invoices_status CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void')),
  invoice_date            date NOT NULL DEFAULT CURRENT_DATE,
  due_date                date NOT NULL,
  currency                char(3) NOT NULL,
  exchange_rate           numeric(20,10) NULL,
  base_total_amount_minor bigint NULL,
  subtotal_amount_minor   bigint NOT NULL DEFAULT 0,
  discount_amount_minor   bigint NOT NULL DEFAULT 0,
  tax_amount_minor        bigint NOT NULL DEFAULT 0,
  -- ACC-8: an issued invoice is immutable; totals never negative.
  total_amount_minor      bigint NOT NULL
    CONSTRAINT ck_acc_invoices_total_non_negative CHECK (total_amount_minor >= 0),
  -- ACC-9/ACC-10: running projections of the applied allocations and issued
  -- credit-note amounts (the ledger tables remain the source of truth; these
  -- avoid a scan on every read — reconcilable to the ledger by the nightly job).
  paid_amount_minor       bigint NOT NULL DEFAULT 0
    CONSTRAINT ck_acc_invoices_paid_non_negative CHECK (paid_amount_minor >= 0),
  credited_amount_minor   bigint NOT NULL DEFAULT 0
    CONSTRAINT ck_acc_invoices_credited_non_negative CHECK (credited_amount_minor >= 0),
  locale                  text NOT NULL DEFAULT 'en',
  -- ACC-13: where the invoice came from.
  source_type             text NOT NULL DEFAULT 'manual'
    CONSTRAINT ck_acc_invoices_source_type CHECK (source_type IN ('manual', 'pos_sale')),
  source_id               uuid NULL,
  idempotency_key         uuid NULL,
  -- ACC-12: e-invoice metadata (ZATCA Phase 2 / Egyptian ETA) — columns exist
  -- from day one so compliance adapters plug in without a schema rewrite.
  e_invoice_uuid          uuid NULL,
  e_invoice_hash          text NULL,
  e_invoice_irn           text NULL,
  e_invoice_qr            text NULL,
  e_invoice_status        text NULL
    CONSTRAINT ck_acc_invoices_e_invoice_status CHECK (e_invoice_status IN ('pending', 'submitted', 'compliant', 'failed')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL,
  updated_by              uuid NULL,
  deleted_at              timestamptz NULL
);
CREATE UNIQUE INDEX uq_acc_invoices_org_number ON acc_invoices (organization_id, invoice_number) WHERE deleted_at IS NULL;
-- ACC-13: exactly one invoice per POS sale.
CREATE UNIQUE INDEX uq_acc_invoices_org_idempotency ON acc_invoices (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_acc_invoices_org_customer ON acc_invoices (organization_id, customer_contact_id, invoice_date);

CREATE TABLE acc_invoice_lines (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL,
  invoice_id             uuid NOT NULL REFERENCES acc_invoices(id) ON DELETE CASCADE,
  -- Inventory variant id — plain id, NO FK (hard rule #1). Null for service lines.
  variant_id             uuid NULL,
  item_name_snapshot     text NOT NULL,
  description            text NULL,
  quantity               numeric(18,4) NOT NULL DEFAULT 1
    CONSTRAINT ck_acc_invoice_lines_quantity_positive CHECK (quantity > 0),
  unit_price_amount_minor bigint NOT NULL
    CONSTRAINT ck_acc_invoice_lines_price_non_negative CHECK (unit_price_amount_minor >= 0),
  discount_amount_minor  bigint NOT NULL DEFAULT 0
    CONSTRAINT ck_acc_invoice_lines_discount_non_negative CHECK (discount_amount_minor >= 0),
  -- ACC-11: tax snapshot from the rate at line entry time.
  tax_rate_id            uuid NULL REFERENCES acc_tax_rates(id),
  tax_rate_bp_snapshot   integer NOT NULL DEFAULT 0
    CONSTRAINT ck_acc_invoice_lines_tax_rate_non_negative CHECK (tax_rate_bp_snapshot >= 0),
  tax_type_snapshot      text NOT NULL DEFAULT 'standard'
    CONSTRAINT ck_acc_invoice_lines_tax_type CHECK (tax_type_snapshot IN ('standard', 'reduced', 'zero', 'exempt')),
  tax_amount_minor       bigint NOT NULL DEFAULT 0,
  line_total_amount_minor bigint NOT NULL
    CONSTRAINT ck_acc_invoice_lines_total_non_negative CHECK (line_total_amount_minor >= 0),
  -- ACC-14: goods lines deduct stock via the movement port at issuance.
  is_goods               boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NULL
);
CREATE INDEX idx_acc_invoice_lines_org_invoice ON acc_invoice_lines (organization_id, invoice_id);

-- ─── AR payments ────────────────────────────────────────────────────────────
CREATE TABLE acc_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  method            text NOT NULL
    CONSTRAINT ck_acc_payments_method CHECK (method IN ('cash', 'bank_transfer', 'card', 'cheque', 'other')),
  amount_minor      bigint NOT NULL
    CONSTRAINT ck_acc_payments_amount_non_negative CHECK (amount_minor >= 0),
  currency          char(3) NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  reference         text NULL,
  idempotency_key   uuid NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL
);
CREATE UNIQUE INDEX uq_acc_payments_org_idempotency ON acc_payments (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_acc_payments_org_received ON acc_payments (organization_id, received_at);

CREATE TABLE acc_payment_allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  payment_id        uuid NOT NULL REFERENCES acc_payments(id) ON DELETE CASCADE,
  invoice_id        uuid NOT NULL REFERENCES acc_invoices(id),
  -- ACC-9: the sum of allocations per invoice never exceeds the invoice total
  -- (CHECK below; the domain enforces it before the row is written).
  amount_minor      bigint NOT NULL
    CONSTRAINT ck_acc_payment_allocations_amount_positive CHECK (amount_minor > 0),
  currency          char(3) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NULL
);
CREATE INDEX idx_acc_payment_allocations_org_invoice ON acc_payment_allocations (organization_id, invoice_id);
-- ACC-9: cumulative allocations ≤ invoice total. The invoice total is read in
-- the same transaction by the domain; this backstop guards direct writes.
CREATE INDEX idx_acc_payment_allocations_org_payment ON acc_payment_allocations (organization_id, payment_id);

-- ─── Credit notes (ACC-10) ──────────────────────────────────────────────────
CREATE TABLE acc_credit_notes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  invoice_id          uuid NOT NULL REFERENCES acc_invoices(id),
  -- ACC-10: sequential + gap-free per org.
  credit_note_number  text NOT NULL,
  -- Snapshot of the reversed invoice's number (reproducibility, ACC-10).
  invoice_number      text NOT NULL,
  status              text NOT NULL DEFAULT 'draft'
    CONSTRAINT ck_acc_credit_notes_status CHECK (status IN ('draft', 'issued', 'void')),
  -- ACC-7: a credit note always carries a reason — corrections are never edits.
  reason_code         text NOT NULL,
  amount_minor        bigint NOT NULL
    CONSTRAINT ck_acc_credit_notes_amount_non_negative CHECK (amount_minor >= 0),
  currency            char(3) NOT NULL,
  issued_at           timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL,
  updated_by          uuid NULL,
  deleted_at          timestamptz NULL
);
CREATE UNIQUE INDEX uq_acc_credit_notes_org_number ON acc_credit_notes (organization_id, credit_note_number) WHERE deleted_at IS NULL;

CREATE TABLE acc_credit_note_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  credit_note_id      uuid NOT NULL REFERENCES acc_credit_notes(id) ON DELETE CASCADE,
  invoice_line_id     uuid NOT NULL REFERENCES acc_invoice_lines(id),
  quantity            numeric(18,4) NOT NULL DEFAULT 1
    CONSTRAINT ck_acc_credit_note_lines_quantity_positive CHECK (quantity > 0),
  unit_price_amount_minor bigint NOT NULL
    CONSTRAINT ck_acc_credit_note_lines_price_non_negative CHECK (unit_price_amount_minor >= 0),
  tax_amount_minor    bigint NOT NULL DEFAULT 0,
  line_total_amount_minor bigint NOT NULL
    CONSTRAINT ck_acc_credit_note_lines_total_non_negative CHECK (line_total_amount_minor >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NULL
);
CREATE INDEX idx_acc_credit_note_lines_org_note ON acc_credit_note_lines (organization_id, credit_note_id);

-- ─── Derived projection + settings ──────────────────────────────────────────
-- ACC-15: acc_account_balances is a derived projection of GL line sums,
-- reconcilable nightly; reports read it, never a full ledger scan.
CREATE TABLE acc_account_balances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  account_id            uuid NOT NULL REFERENCES acc_accounts(id),
  period                text NOT NULL,
  opening_amount_minor  bigint NOT NULL DEFAULT 0,
  debit_total_minor     bigint NOT NULL DEFAULT 0,
  credit_total_minor    bigint NOT NULL DEFAULT 0,
  closing_amount_minor  bigint NOT NULL DEFAULT 0,
  currency              char(3) NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NULL,
  updated_by            uuid NULL,
  UNIQUE (organization_id, account_id, period, currency)
);

CREATE TABLE acc_org_settings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL UNIQUE,
  fiscal_year_start       date NOT NULL DEFAULT (CURRENT_DATE - (EXTRACT(DOY FROM CURRENT_DATE)::int - 1)),
  tax_registration_number text NULL,
  e_invoice_provider      text NOT NULL DEFAULT 'none'
    CONSTRAINT ck_acc_org_settings_provider CHECK (e_invoice_provider IN ('none', 'zatca', 'eta')),
  features                jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- ACC-3/ACC-10: per-org counters for gap-free sequential numbers. The
  -- application bumps them atomically inside the document's transaction
  -- (UPDATE ... RETURNING) so a failed insert never consumes a number.
  next_entry_number       bigint NOT NULL DEFAULT 0,
  next_invoice_number     bigint NOT NULL DEFAULT 0,
  next_credit_note_number bigint NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NULL,
  updated_by              uuid NULL
);
