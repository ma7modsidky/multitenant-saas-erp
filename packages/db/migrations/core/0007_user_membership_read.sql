-- 0007_user_membership_read.sql
-- Allow a user to read their own memberships across the organizations they
-- belong to (TEN-4). Backs the organization switcher:
--   GET /v1/users/me/organizations
--
-- The existing `tenant_isolation` policy on core_memberships is FOR ALL and
-- org-scoped, which fails closed for cross-org reads (a token is bound to a
-- single active organization). This adds a second, narrower SELECT policy
-- scoped to the authenticated user id, so a user can list only the rows where
-- they are the member — never another tenant's data.
--
-- The policy is read-only (SELECT) and does not weaken write isolation:
-- INSERT/UPDATE/DELETE still require the active org to match.
--
-- Fix forward: the original policy is in 0003_rls.sql (merged); do not edit it.

CREATE POLICY user_own_memberships ON core_memberships
    FOR SELECT
    TO modubiz_app
    USING (user_id = current_setting('app.current_user_id', true)::uuid AND deleted_at IS NULL);

COMMENT ON POLICY user_own_memberships ON core_memberships IS 'Lets a user read their own memberships across orgs for the org switcher (TEN-4). Read-only; write isolation unchanged.';
