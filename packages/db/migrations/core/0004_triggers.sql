-- 0004_triggers.sql
-- Trigger function and attachments for automatic updated_at maintenance.
--
-- Every table with an updated_at column gets a BEFORE UPDATE trigger
-- that sets updated_at = now() on every row modification.
--
-- @see DATA_MODEL.md §3 — Universal column conventions

-- ─── Trigger function ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_updated_at() IS 'Sets updated_at to now() on every UPDATE. Attached to all tables with an updated_at column.';

-- ─── Attach triggers to tables with updated_at ──────────────────────────────
-- Global tables
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON core_users
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON core_organizations
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON core_module_catalog
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Tenant tables
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON core_memberships
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON core_roles
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON core_invitations
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON core_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON core_module_entitlements
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON core_data_exports
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON core_organization_settings
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- NOTE: The following tables do NOT have updated_at:
-- - core_sessions (immutable after creation)
-- - core_currencies (reference data, updated manually)
-- - core_fx_rates (append-only snapshots)
-- - core_permissions (mirrored from descriptors, managed by boot process)
-- - core_audit_log (append-only, no UPDATE allowed)
-- - core_notifications (only read_at is mutable)
-- - core_outbox (append-only, only published_at/attempts/failed_reason are mutable)
