-- 0001_global_tables.sql
-- Global (non-tenant) platform tables.
-- These tables are NOT RLS-protected — row visibility is governed by
-- membership queries and application logic.
--
-- @see DATA_MODEL.md §4.1

-- ─── citext extension (case-insensitive text) ───────────────────────────────
CREATE EXTENSION IF NOT EXISTS citext;

-- ─── core_users ─────────────────────────────────────────────────────────────
CREATE TABLE core_users (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email             citext NOT NULL UNIQUE,
    password_hash     text NOT NULL,
    name              text NOT NULL,
    preferred_locale  text,
    email_verified_at timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_core_users_email ON core_users (email);

COMMENT ON TABLE  core_users              IS 'User identities. Row visibility governed by membership queries, not RLS.';
COMMENT ON COLUMN core_users.email        IS 'Unique, case-insensitive (citext). Stored normalized (trimmed, lowercased).';
COMMENT ON COLUMN core_users.password_hash IS 'Argon2id hash. Never logged, returned, or included in exports.';

-- ─── core_sessions ──────────────────────────────────────────────────────────
CREATE TABLE core_sessions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES core_users(id),
    token_hash  text NOT NULL,
    device      text,
    ip          text,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    family      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_core_sessions_user_id ON core_sessions (user_id);
CREATE INDEX idx_core_sessions_family  ON core_sessions (family);

COMMENT ON TABLE  core_sessions             IS 'Refresh-token sessions. Only hash of the refresh token is stored.';
COMMENT ON COLUMN core_sessions.token_hash  IS 'Hash of the refresh token. Never the raw token.';
COMMENT ON COLUMN core_sessions.family      IS 'Session family identifier. Reuse of a rotated token revokes all sessions with the same family.';

-- ─── core_organizations ─────────────────────────────────────────────────────
CREATE TABLE core_organizations (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  text NOT NULL,
    slug                  citext NOT NULL UNIQUE,
    country_code          char(2) NOT NULL,
    timezone              text NOT NULL DEFAULT 'UTC',
    base_currency         char(3) NOT NULL,
    default_locale        text NOT NULL DEFAULT 'en',
    status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'suspended', 'pending_deletion')),
    deletion_scheduled_at timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  core_organizations              IS 'Tenant organizations. The top-level entity for multi-tenancy.';
COMMENT ON COLUMN core_organizations.slug         IS 'Unique URL-friendly identifier.';
COMMENT ON COLUMN core_organizations.base_currency IS 'Immutable once any monetary record exists for the organization.';
COMMENT ON COLUMN core_organizations.status       IS 'active | suspended | pending_deletion';

-- ─── core_currencies ────────────────────────────────────────────────────────
CREATE TABLE core_currencies (
    code      char(3) PRIMARY KEY,
    exponent  integer NOT NULL,
    symbol    text NOT NULL,
    name      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  core_currencies IS 'ISO 4217 currency reference table. Read-only reference data.';

-- ─── core_fx_rates ──────────────────────────────────────────────────────────
CREATE TABLE core_fx_rates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    base_currency   char(3) NOT NULL REFERENCES core_currencies(code),
    quote_currency  char(3) NOT NULL REFERENCES core_currencies(code),
    rate            numeric(20,10) NOT NULL,
    valid_on        date NOT NULL,
    source          text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_core_fx_rates_pair_date ON core_fx_rates (base_currency, quote_currency, valid_on DESC);

COMMENT ON TABLE  core_fx_rates IS 'Daily FX rate snapshots. Historical rates never change.';

-- ─── core_module_catalog ────────────────────────────────────────────────────
CREATE TABLE core_module_catalog (
    key               text PRIMARY KEY,
    version           text NOT NULL,
    name              text NOT NULL,
    description       text,
    icon              text,
    depends_on        text[] DEFAULT '{}',
    table_prefix      text NOT NULL UNIQUE,
    stripe_price_key  text,
    trial_days        integer NOT NULL DEFAULT 14,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core_module_catalog IS 'Registered modules. Mirrored from descriptors at boot. Read-only reference data.';

-- ─── core_permissions ───────────────────────────────────────────────────────
CREATE TABLE core_permissions (
    key         text PRIMARY KEY,
    module_key  text NOT NULL REFERENCES core_module_catalog(key),
    description text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_core_permissions_module_key ON core_permissions (module_key);

COMMENT ON TABLE core_permissions IS 'Permission catalog. Mirrored from descriptors at boot. Read-only reference data.';
