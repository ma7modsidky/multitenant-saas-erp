-- 0013_platform_admin.sql
-- Platform Admin Console foundations (PLT-*):
--   1. core_users.is_platform_admin          — the superuser flag (PLT-1)
--   2. core_saas_settings                    — platform-level settings (key → jsonb), allow-listed keys (PLT-7)
--   3. core_module_pricing                   — admin-editable module list prices (display/planning, PLT-6)
--   4. core_platform_audit_log               — append-only trail for platform-admin actions (PLT-4, TEN-5)
--
-- All four are GLOBAL (non-tenant) tables: no organization_id, no RLS.
-- Tenant-table access from admin code still binds one organization per query
-- via TransactionManager.runWithOrg (PLT-3).
--
-- @see docs/ARCHITECTURE.md §8 — Platform Admin Console
-- @see docs/DATA_MODEL.md §4.1 — Global (non-tenant) tables
-- @see docs/BUSINESS_RULES.md §12 — Platform administration rules
--
-- Fix forward: no merged migration is edited.

-- ─── 1. Platform-admin flag on core_users ──────────────────────────────────
ALTER TABLE core_users
    ADD COLUMN is_platform_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN core_users.is_platform_admin IS
    'Platform-admin (superuser) flag for the /admin back-office (PLT-1). Seeded from PLATFORM_ADMIN_EMAILS at boot; minted into access tokens and sessions.';

-- ─── 2. Platform-level settings ────────────────────────────────────────────
CREATE TABLE core_saas_settings (
    key        text PRIMARY KEY,
    value      jsonb NOT NULL,
    updated_by uuid REFERENCES core_users(id),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core_saas_settings IS
    'Platform-level settings for the SaaS operator (key → jsonb). Global, admin-managed; allow-listed keys only (PLT-7).';

-- ─── 3. Admin-editable module list prices ──────────────────────────────────
CREATE TABLE core_module_pricing (
    module_key          text PRIMARY KEY REFERENCES core_module_catalog(key) ON DELETE CASCADE,
    price_monthly_minor bigint NOT NULL DEFAULT 0,
    price_yearly_minor  bigint NOT NULL DEFAULT 0,
    currency            char(3) NOT NULL DEFAULT 'USD',
    updated_by          uuid REFERENCES core_users(id),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core_module_pricing IS
    'Admin-editable module list prices in integer minor units. Display/planning data only — the commercial authority stays Stripe (BILL-10, PLT-6).';

-- ─── 4. Append-only platform admin audit trail ─────────────────────────────
CREATE TABLE core_platform_audit_log (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid REFERENCES core_users(id),
    actor_email   text,
    action        text NOT NULL,
    entity_type   text NOT NULL,
    entity_id     text,
    before        jsonb,
    after         jsonb,
    metadata      jsonb,
    occurred_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_core_platform_audit_log_occurred_at
    ON core_platform_audit_log (occurred_at DESC);

CREATE INDEX idx_core_platform_audit_log_entity
    ON core_platform_audit_log (entity_type, entity_id);

COMMENT ON TABLE core_platform_audit_log IS
    'Append-only audit trail for platform-admin actions (PLT-4). Separate from the tenant-scoped core_audit_log per TEN-5. No UPDATE/DELETE path (AUD-2).';
