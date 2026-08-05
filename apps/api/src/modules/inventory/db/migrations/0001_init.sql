-- 0001_init.sql — inventory module initial schema
-- Follow DATA_MODEL.md §2 (mandatory base columns) + §5 (money pairs) + §8.
--
-- Critical invariants (BUSINESS_RULES.md §8):
--   INV-10  SKU / barcode unique per org among non-deleted variants
--   INV-15  quantities are numeric(18,4) (fractional UoM units)
--   INV-16  movements carry an optional idempotency_key, unique per org
-- Append-only ledger (`inv_stock_movements`) lives in 0003_append_only.sql.

CREATE TABLE inv_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name_i18n       jsonb NOT NULL DEFAULT '{}'::jsonb,
  parent_id       uuid NULL REFERENCES inv_categories(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL,
  updated_by      uuid NULL,
  deleted_at      timestamptz NULL
);

CREATE TABLE inv_units_of_measure (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  code            text NOT NULL,
  name_i18n       jsonb NOT NULL DEFAULT '{}'::jsonb,
  precision       integer NOT NULL DEFAULT 0 CHECK (precision BETWEEN 0 AND 4),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL,
  updated_by      uuid NULL,
  deleted_at      timestamptz NULL
);
CREATE UNIQUE INDEX uq_inv_uom_org_code ON inv_units_of_measure (organization_id, code) WHERE deleted_at IS NULL;

CREATE TABLE inv_products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  name_i18n        jsonb NOT NULL DEFAULT '{}'::jsonb,
  description_i18n jsonb NOT NULL DEFAULT '{}'::jsonb,
  category_id      uuid NULL REFERENCES inv_categories(id),
  uom_id           uuid NOT NULL REFERENCES inv_units_of_measure(id),
  is_active        boolean NOT NULL DEFAULT true,
  tax_rate_bp      integer NOT NULL DEFAULT 0 CHECK (tax_rate_bp >= 0),
  tracking_mode    text NOT NULL DEFAULT 'quantity'
    CHECK (tracking_mode IN ('none', 'quantity')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NULL,
  updated_by       uuid NULL,
  deleted_at       timestamptz NULL
);

-- Name search support: generated column + index (DATA_MODEL.md §6).
ALTER TABLE inv_products
  ADD COLUMN name_default text GENERATED ALWAYS AS (name_i18n ->> 'en') STORED;
CREATE INDEX idx_inv_products_name_default ON inv_products (organization_id, name_default);

CREATE TABLE inv_product_variants (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  product_id           uuid NOT NULL REFERENCES inv_products(id),
  sku                  text NOT NULL,
  barcode              text NULL,
  attributes           jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_amount_minor   bigint NOT NULL DEFAULT 0,
  price_currency       char(3) NOT NULL,
  cost_amount_minor    bigint NOT NULL DEFAULT 0,
  cost_currency        char(3) NOT NULL,
  reorder_point        numeric(18,4) NOT NULL DEFAULT 0,
  reorder_quantity     numeric(18,4) NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NULL,
  updated_by           uuid NULL,
  deleted_at           timestamptz NULL,
  CONSTRAINT ck_inv_variants_price_non_negative CHECK (price_amount_minor >= 0),
  CONSTRAINT ck_inv_variants_cost_non_negative CHECK (cost_amount_minor >= 0),
  CONSTRAINT ck_inv_variants_reorder_non_negative CHECK (reorder_point >= 0 AND reorder_quantity >= 0)
);
-- INV-10: SKU and barcode unique per org among non-deleted variants.
CREATE UNIQUE INDEX uq_inv_variants_org_sku ON inv_product_variants (organization_id, sku) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_inv_variants_org_barcode ON inv_product_variants (organization_id, barcode) WHERE deleted_at IS NULL AND barcode IS NOT NULL;

CREATE TABLE inv_warehouses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name            text NOT NULL,
  code            text NOT NULL,
  address         jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default      boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL,
  updated_by      uuid NULL,
  deleted_at      timestamptz NULL
);
CREATE UNIQUE INDEX uq_inv_warehouses_org_code ON inv_warehouses (organization_id, code) WHERE deleted_at IS NULL;
-- At most one default warehouse per org.
CREATE UNIQUE INDEX uq_inv_warehouses_org_default ON inv_warehouses (organization_id) WHERE is_default AND deleted_at IS NULL;

CREATE TABLE inv_stock_levels (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  variant_id           uuid NOT NULL REFERENCES inv_product_variants(id),
  warehouse_id         uuid NOT NULL REFERENCES inv_warehouses(id),
  quantity_on_hand     numeric(18,4) NOT NULL DEFAULT 0,
  quantity_reserved    numeric(18,4) NOT NULL DEFAULT 0,
  last_movement_id     uuid NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NULL,
  updated_by           uuid NULL,
  deleted_at           timestamptz NULL,
  CONSTRAINT ck_inv_stock_levels_on_hand_non_negative CHECK (quantity_on_hand >= 0),
  CONSTRAINT ck_inv_stock_levels_reserved_non_negative CHECK (quantity_reserved >= 0)
);
CREATE UNIQUE INDEX uq_inv_stock_levels_variant_warehouse
  ON inv_stock_levels (organization_id, variant_id, warehouse_id) WHERE deleted_at IS NULL;

-- Append-only ledger — the single source of truth (INV-1). No deleted_at,
-- no update/delete path (enforced by trigger in 0003_append_only.sql).
CREATE TABLE inv_stock_movements (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL,
  variant_id             uuid NOT NULL REFERENCES inv_product_variants(id),
  warehouse_id           uuid NOT NULL REFERENCES inv_warehouses(id),
  type                   text NOT NULL CHECK (type IN (
                           'receipt', 'sale', 'return', 'transfer_in', 'transfer_out',
                           'adjustment', 'count_correction', 'write_off'
                         )),
  quantity               numeric(18,4) NOT NULL,
  unit_cost_amount_minor bigint NULL,
  unit_cost_currency     char(3) NULL,
  reference_type         text NOT NULL,
  reference_id           uuid NOT NULL,
  reason_code            text NULL,
  idempotency_key        uuid NULL,
  occurred_at            timestamptz NOT NULL DEFAULT now(),
  created_by             uuid NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_inv_movements_non_zero CHECK (quantity <> 0)
);
-- INV-16: retried operations cannot double-count.
CREATE UNIQUE INDEX uq_inv_movements_org_idempotency
  ON inv_stock_movements (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_inv_movements_org_variant_warehouse
  ON inv_stock_movements (organization_id, variant_id, warehouse_id, occurred_at);
-- INV-2: projection reconstruction (SUM over the ledger per variant+warehouse).
CREATE INDEX idx_inv_movements_org_variant
  ON inv_stock_movements (organization_id, variant_id, warehouse_id);

CREATE TABLE inv_stock_reservations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  variant_id      uuid NOT NULL REFERENCES inv_product_variants(id),
  warehouse_id    uuid NOT NULL REFERENCES inv_warehouses(id),
  quantity        numeric(18,4) NOT NULL CHECK (quantity > 0),
  state           text NOT NULL DEFAULT 'held'
    CHECK (state IN ('held', 'committed', 'released', 'expired')),
  expires_at      timestamptz NOT NULL,
  reference_type  text NOT NULL,
  reference_id    uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL,
  updated_by      uuid NULL
);
CREATE INDEX idx_inv_reservations_org_expires
  ON inv_stock_reservations (organization_id, state, expires_at);

CREATE TABLE inv_stock_counts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  warehouse_id    uuid NOT NULL REFERENCES inv_warehouses(id),
  status          text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'applied')),
  counted_at      timestamptz NULL,
  counted_by      uuid NULL,
  notes           text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL,
  updated_by      uuid NULL,
  deleted_at      timestamptz NULL
);

CREATE TABLE inv_stock_count_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL,
  stock_count_id     uuid NOT NULL REFERENCES inv_stock_counts(id) ON DELETE CASCADE,
  variant_id         uuid NOT NULL REFERENCES inv_product_variants(id),
  expected_quantity  numeric(18,4) NOT NULL,
  counted_quantity   numeric(18,4) NOT NULL,
  variance           numeric(18,4) NOT NULL GENERATED ALWAYS AS (counted_quantity - expected_quantity) STORED,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NULL,
  updated_by         uuid NULL
);

CREATE TABLE inv_low_stock_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  variant_id      uuid NOT NULL REFERENCES inv_product_variants(id),
  warehouse_id    uuid NOT NULL REFERENCES inv_warehouses(id),
  triggered_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- INV-13: no alert storms — one open alert per (variant, warehouse).
CREATE UNIQUE INDEX uq_inv_low_stock_alerts_open
  ON inv_low_stock_alerts (organization_id, variant_id, warehouse_id) WHERE resolved_at IS NULL;
