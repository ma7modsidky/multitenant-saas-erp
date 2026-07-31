-- 0002_tenant_tables.sql
-- Tenant-scoped platform tables.
-- Every table in this file MUST have the standard RLS policy applied
-- (see 0003_rls.sql). All tables include organization_id as the RLS key.
--
-- @see DATA_MODEL.md §4.2

-- ─── core_memberships ───────────────────────────────────────────────────────
CREATE TABLE core_memberships (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL REFERENCES core_organizations(id),
    user_id           uuid NOT NULL REFERENCES core_users(id),
    role_id           uuid NOT NULL,
    status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'inactive')),
    joined_at         timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid,
    updated_by        uuid,
    deleted_at        timestamptz,
    UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_core_memberships_user_id ON core_memberships (user_id);
CREATE INDEX idx_core_memberships_role_id ON core_memberships (role_id);

COMMENT ON TABLE  core_memberships           IS 'Links a user to an organization with a role.';
COMMENT ON COLUMN core_memberships.role_id   IS 'FK to core_roles. Added via ALTER TABLE below after core_roles is created in this migration.';

-- ─── core_roles ─────────────────────────────────────────────────────────────
CREATE TABLE core_roles (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL REFERENCES core_organizations(id),
    key               text NOT NULL,
    name_i18n         jsonb NOT NULL DEFAULT '{}',
    description       text,
    is_system         boolean NOT NULL DEFAULT false,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid,
    updated_by        uuid,
    deleted_at        timestamptz,
    UNIQUE (organization_id, key)
);

COMMENT ON COLUMN core_roles.name_i18n IS 'Translatable role name: {"en": "Manager", "ar": "مدير"}.';
COMMENT ON COLUMN core_roles.is_system  IS 'System roles (OWNER, ADMIN, MANAGER, MEMBER, VIEWER) cannot be deleted or renamed.';

-- Add FK from core_memberships.role_id to core_roles.id
ALTER TABLE core_memberships
    ADD CONSTRAINT fk_core_memberships_role_id
    FOREIGN KEY (role_id) REFERENCES core_roles(id);

-- ─── core_role_permissions ──────────────────────────────────────────────────
CREATE TABLE core_role_permissions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL REFERENCES core_organizations(id),
    role_id           uuid NOT NULL REFERENCES core_roles(id),
    permission_key    text NOT NULL REFERENCES core_permissions(key),
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid,
    UNIQUE (organization_id, role_id, permission_key)
);

CREATE INDEX idx_core_role_permissions_role_id ON core_role_permissions (role_id);

COMMENT ON TABLE core_role_permissions IS 'Maps roles to permission keys. Custom roles only combine module permissions.';

-- ─── core_invitations ───────────────────────────────────────────────────────
CREATE TABLE core_invitations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL REFERENCES core_organizations(id),
    email             citext NOT NULL,
    role_id           uuid NOT NULL REFERENCES core_roles(id),
    token_hash        text NOT NULL,
    expires_at        timestamptz NOT NULL,
    accepted_at       timestamptz,
    revoked_at        timestamptz,
    invited_by        uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    deleted_at        timestamptz
);

CREATE INDEX idx_core_invitations_email ON core_invitations (email);
CREATE INDEX idx_core_invitations_org_email ON core_invitations (organization_id, email);

COMMENT ON TABLE  core_invitations            IS 'Pending membership invitations. Tokens are single-use and expire.';
COMMENT ON COLUMN core_invitations.token_hash IS 'Hash of the invitation token. Never the raw token.';

-- ─── core_subscriptions ─────────────────────────────────────────────────────
CREATE TABLE core_subscriptions (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         uuid NOT NULL REFERENCES core_organizations(id),
    stripe_customer_id      text NOT NULL,
    stripe_subscription_id  text NOT NULL,
    status                  text NOT NULL,
    billing_currency        char(3) NOT NULL,
    current_period_end      timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, stripe_subscription_id)
);

CREATE INDEX idx_core_subscriptions_stripe_customer ON core_subscriptions (stripe_customer_id);

COMMENT ON TABLE core_subscriptions IS 'Stripe subscription mirror. The source of billing truth is Stripe.';

-- ─── core_module_entitlements ───────────────────────────────────────────────
CREATE TABLE core_module_entitlements (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             uuid NOT NULL REFERENCES core_organizations(id),
    module_key                  text NOT NULL REFERENCES core_module_catalog(key),
    state                       text NOT NULL
                                CHECK (state IN ('available', 'trialing', 'active', 'past_due', 'expired', 'suspended', 'disabled')),
    trial_started_at            timestamptz,
    trial_ends_at               timestamptz,
    activated_at                timestamptz,
    disabled_at                 timestamptz,
    purge_after                 timestamptz,
    stripe_subscription_item_id text,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, module_key)
);

COMMENT ON TABLE core_module_entitlements IS 'Runtime authority for module access. The state machine drives all transitions.';
COMMENT ON COLUMN core_module_entitlements.state IS 'available | trialing | active | past_due | expired | suspended | disabled';

-- ─── core_audit_log ─────────────────────────────────────────────────────────
-- APPEND-ONLY: No UPDATE, no DELETE, no deleted_at.
CREATE TABLE core_audit_log (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL REFERENCES core_organizations(id),
    actor_user_id     uuid,
    actor_type        text NOT NULL,
    action            text NOT NULL,
    entity_type       text NOT NULL,
    entity_id         text NOT NULL,
    before            jsonb,
    after             jsonb,
    ip                text,
    correlation_id    text,
    occurred_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_core_audit_log_org_entity ON core_audit_log (organization_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_core_audit_log_org_actor  ON core_audit_log (organization_id, actor_user_id, occurred_at DESC);

COMMENT ON TABLE  core_audit_log IS 'Append-only audit trail. No UPDATE or DELETE allowed (enforced by trigger).';
COMMENT ON COLUMN core_audit_log.before IS 'JSON snapshot of the entity state before the mutation.';
COMMENT ON COLUMN core_audit_log.after  IS 'JSON snapshot of the entity state after the mutation.';

-- ─── core_notifications ─────────────────────────────────────────────────────
CREATE TABLE core_notifications (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL REFERENCES core_organizations(id),
    user_id           uuid NOT NULL REFERENCES core_users(id),
    type              text NOT NULL,
    payload           jsonb DEFAULT '{}',
    read_at           timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    deleted_at        timestamptz
);

CREATE INDEX idx_core_notifications_user ON core_notifications (organization_id, user_id, created_at DESC);

COMMENT ON TABLE core_notifications IS 'In-app notifications. Delivery is best-effort and async.';

-- ─── core_outbox ────────────────────────────────────────────────────────────
-- APPEND-ONLY: No UPDATE, no DELETE, no deleted_at.
CREATE TABLE core_outbox (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL REFERENCES core_organizations(id),
    event_name        text NOT NULL,
    payload           jsonb NOT NULL,
    published_at      timestamptz,
    attempts          integer NOT NULL DEFAULT 0,
    failed_reason     text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_core_outbox_unpublished ON core_outbox (organization_id, published_at NULLS FIRST, created_at ASC);

COMMENT ON TABLE core_outbox IS 'Transactional outbox for durable event publishing. Events are published after commit.';

-- ─── core_data_exports ──────────────────────────────────────────────────────
CREATE TABLE core_data_exports (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid NOT NULL REFERENCES core_organizations(id),
    type              text NOT NULL,
    status            text NOT NULL
                      CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    requested_by      uuid,
    file_key          text,
    expires_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    deleted_at        timestamptz
);

COMMENT ON TABLE core_data_exports IS 'Data export and GDPR erasure request tracking.';

-- ─── core_organization_settings ─────────────────────────────────────────────
CREATE TABLE core_organization_settings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES core_organizations(id) UNIQUE,
    locale              text NOT NULL DEFAULT 'en',
    timezone            text NOT NULL DEFAULT 'UTC',
    base_currency       char(3) NOT NULL,
    number_preferences  jsonb DEFAULT '{}',
    date_preferences    jsonb DEFAULT '{}',
    receipt_footer      text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core_organization_settings IS 'One row per organization. Settings for locale, timezone, formatting, and receipts.';
