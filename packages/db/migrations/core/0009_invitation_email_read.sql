-- 0009_invitation_email_read.sql
-- Allow a user to read an invitation sent to their email so they can accept
-- it BEFORE joining the organization (AUTH-3, AUTH-9).
--
-- core_invitations is org-scoped RLS, but the invitee is not yet a member and
-- their access token carries no organization. This adds a second, narrower
-- SELECT policy keyed on the authenticated user's email (resolved through
-- core_users, a global non-RLS table). Read-only; write isolation unchanged.
--
-- Fix forward: the original policy is in 0003_rls.sql (merged); do not edit it.
-- Hardened with NULLIF against the custom-GUC reset to empty string (0008).

CREATE POLICY user_own_invitations ON core_invitations
    FOR SELECT
    TO modubiz_app
    USING (
      email = (
        SELECT u.email FROM core_users u
        WHERE u.id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
      AND deleted_at IS NULL
    );

COMMENT ON POLICY user_own_invitations ON core_invitations IS 'Lets a user read an invitation sent to their email so they can accept it before joining (AUTH-3, AUTH-9). Read-only; write isolation unchanged. Hardened with NULLIF (0008).';
