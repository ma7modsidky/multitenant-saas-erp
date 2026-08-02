-- 0008_nullif_rls_policies.sql
-- Harden tenant RLS policies against PostgreSQL custom-GUC reset semantics (TEN-3).
--
-- PROBLEM:
-- PostgreSQL resets custom GUCs (`app.current_organization_id`,
-- `app.current_user_id`) to the EMPTY STRING (''), NOT NULL, after any
-- transaction that touches them via set_config(..., true) — even on a
-- dedicated connection. Every tenant-bound transaction therefore leaves '' on
-- its pooled connection after commit.
--
-- The original policies in 0003_rls.sql cast the raw value:
--     organization_id = current_setting('app.current_organization_id', true)::uuid
-- so the next org-less query on that connection (e.g. switch-org for a freshly
-- signed-up user whose token has no organizationId yet) evaluates ''::uuid and
-- crashes with:
--     invalid input syntax for type uuid: ""  →  HTTP 500 "Something went wrong"
--
-- FIX:
-- Wrap the setting in NULLIF(value, '') so both unset (NULL) and reset ('')
-- behave identically: NULL → predicate is NULL → fail-closed, zero rows, and
-- never a uuid-cast error.
--     organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
--
-- Fix forward: 0003_rls.sql and 0007_user_membership_read.sql are merged and
-- must not be edited. This migration drops and recreates every tenant_isolation
-- policy (and the user_own_memberships policy) with the hardened cast.
--
-- @see DATA_MODEL.md §2 — The RLS pattern (copy this exactly)

-- ─── core_memberships ───────────────────────────────────────────────────────
DROP POLICY tenant_isolation ON core_memberships;
CREATE POLICY tenant_isolation ON core_memberships
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

DROP POLICY user_own_memberships ON core_memberships;
CREATE POLICY user_own_memberships ON core_memberships
    FOR SELECT
    TO modubiz_app
    USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid AND deleted_at IS NULL);

COMMENT ON POLICY user_own_memberships ON core_memberships IS 'Lets a user read their own memberships across orgs for the org switcher (TEN-4). Read-only; write isolation unchanged. Hardened with NULLIF against the custom-GUC reset to empty string (0008).';

-- ─── core_roles ─────────────────────────────────────────────────────────────
DROP POLICY tenant_isolation ON core_roles;
CREATE POLICY tenant_isolation ON core_roles
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── core_role_permissions ──────────────────────────────────────────────────
DROP POLICY tenant_isolation ON core_role_permissions;
CREATE POLICY tenant_isolation ON core_role_permissions
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── core_invitations ───────────────────────────────────────────────────────
DROP POLICY tenant_isolation ON core_invitations;
CREATE POLICY tenant_isolation ON core_invitations
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── core_subscriptions ─────────────────────────────────────────────────────
DROP POLICY tenant_isolation ON core_subscriptions;
CREATE POLICY tenant_isolation ON core_subscriptions
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── core_module_entitlements ───────────────────────────────────────────────
DROP POLICY tenant_isolation ON core_module_entitlements;
CREATE POLICY tenant_isolation ON core_module_entitlements
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── core_audit_log ─────────────────────────────────────────────────────────
DROP POLICY tenant_isolation ON core_audit_log;
CREATE POLICY tenant_isolation ON core_audit_log
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── core_notifications ─────────────────────────────────────────────────────
DROP POLICY tenant_isolation ON core_notifications;
CREATE POLICY tenant_isolation ON core_notifications
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── core_outbox ────────────────────────────────────────────────────────────
DROP POLICY tenant_isolation ON core_outbox;
CREATE POLICY tenant_isolation ON core_outbox
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── core_data_exports ──────────────────────────────────────────────────────
DROP POLICY tenant_isolation ON core_data_exports;
CREATE POLICY tenant_isolation ON core_data_exports
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── core_organization_settings ─────────────────────────────────────────────
DROP POLICY tenant_isolation ON core_organization_settings;
CREATE POLICY tenant_isolation ON core_organization_settings
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── Verification ───────────────────────────────────────────────────────────
-- Every tenant_isolation policy should now wrap the setting in NULLIF(..., '').
--
-- SELECT schemaname, tablename, policyname, qual
-- FROM pg_policies
-- WHERE tablename LIKE 'core\_%' AND policyname = 'tenant_isolation'
-- ORDER BY tablename;
