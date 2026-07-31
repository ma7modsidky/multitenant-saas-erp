-- 0003_rls.sql
-- Row-Level Security policies for tenant-scoped platform tables.
--
-- Every tenant-owned table gets the standard tenant_isolation policy:
--   FOR ALL ... USING (organization_id = current_setting('app.current_organization_id', true)::uuid)
--   WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid)
--
-- Tables without organization_id (global reference tables) are intentionally excluded.
--
-- @see DATA_MODEL.md §2 — The RLS pattern (copy this exactly)

-- ─── Helper function for standard RLS policy ───────────────────────────────
DO $$ BEGIN
    -- Apply RLS to each tenant-scoped table using the standard template.
    -- The policy uses current_setting(..., true) which returns NULL when unset,
    -- making the predicate fail-closed: no tenant context ⇒ zero rows.
END $$;

-- ─── core_memberships ───────────────────────────────────────────────────────
ALTER TABLE core_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core_memberships
    FOR ALL
    TO modubiz_app
    USING      (organization_id = current_setting('app.current_organization_id', true)::uuid)
    WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- ─── core_roles ─────────────────────────────────────────────────────────────
ALTER TABLE core_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_roles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core_roles
    FOR ALL
    TO modubiz_app
    USING      (organization_id = current_setting('app.current_organization_id', true)::uuid)
    WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- ─── core_role_permissions ──────────────────────────────────────────────────
ALTER TABLE core_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_role_permissions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core_role_permissions
    FOR ALL
    TO modubiz_app
    USING      (organization_id = current_setting('app.current_organization_id', true)::uuid)
    WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- ─── core_invitations ───────────────────────────────────────────────────────
ALTER TABLE core_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core_invitations
    FOR ALL
    TO modubiz_app
    USING      (organization_id = current_setting('app.current_organization_id', true)::uuid)
    WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- ─── core_subscriptions ─────────────────────────────────────────────────────
ALTER TABLE core_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core_subscriptions
    FOR ALL
    TO modubiz_app
    USING      (organization_id = current_setting('app.current_organization_id', true)::uuid)
    WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- ─── core_module_entitlements ───────────────────────────────────────────────
ALTER TABLE core_module_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_module_entitlements FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core_module_entitlements
    FOR ALL
    TO modubiz_app
    USING      (organization_id = current_setting('app.current_organization_id', true)::uuid)
    WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- ─── core_audit_log ─────────────────────────────────────────────────────────
ALTER TABLE core_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core_audit_log
    FOR ALL
    TO modubiz_app
    USING      (organization_id = current_setting('app.current_organization_id', true)::uuid)
    WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- ─── core_notifications ─────────────────────────────────────────────────────
ALTER TABLE core_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core_notifications
    FOR ALL
    TO modubiz_app
    USING      (organization_id = current_setting('app.current_organization_id', true)::uuid)
    WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- ─── core_outbox ────────────────────────────────────────────────────────────
ALTER TABLE core_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core_outbox
    FOR ALL
    TO modubiz_app
    USING      (organization_id = current_setting('app.current_organization_id', true)::uuid)
    WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- ─── core_data_exports ──────────────────────────────────────────────────────
ALTER TABLE core_data_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_data_exports FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core_data_exports
    FOR ALL
    TO modubiz_app
    USING      (organization_id = current_setting('app.current_organization_id', true)::uuid)
    WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- ─── core_organization_settings ─────────────────────────────────────────────
ALTER TABLE core_organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_organization_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core_organization_settings
    FOR ALL
    TO modubiz_app
    USING      (organization_id = current_setting('app.current_organization_id', true)::uuid)
    WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- ─── Verification ───────────────────────────────────────────────────────────
-- The following query returns the list of tenant tables with RLS applied.
-- Every tenant table must appear in the results.
--
-- SELECT schemaname, tablename, rowsecurity, forcerowsecurity
-- FROM pg_tables
-- WHERE tablename LIKE 'core\_%'
--   AND tablename NOT IN ('core_users', 'core_sessions', 'core_organizations',
--                         'core_currencies', 'core_fx_rates',
--                         'core_module_catalog', 'core_permissions')
-- ORDER BY tablename;
