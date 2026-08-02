-- 0012_invitation_name.sql
-- Add the invitee's display name to core_invitations.
--
-- Invitations now carry the name the inviter typed next to the email
-- (AUTH-9 / AUTHZ-8): the invitation list shows it, and the public invite
-- link carries it (with the org + role display names) so the invitee sees
-- "You have been invited to join X as Y" before authenticating.
--
-- Nullable so existing pending invitations (created before this migration)
-- keep working; the UI falls back to the email when name is null. New
-- invitations always set it (the Zod DTO requires it).
--
-- Fix forward: no merged migration is edited.

ALTER TABLE core_invitations
    ADD COLUMN name text;

COMMENT ON COLUMN core_invitations.name IS 'Display name of the invitee, as typed by the inviter. Nullable for invitations created before migration 0012; new invites always set it.';
