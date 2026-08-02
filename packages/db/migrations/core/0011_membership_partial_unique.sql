-- 0011_membership_partial_unique.sql
-- Allow a removed member to be re-invited and re-accepted.
--
-- core_memberships uses soft deletes (AUTHZ-7): removing a member sets
-- deleted_at, the row is NOT physically removed. The hard
--   UNIQUE (organization_id, user_id)
-- constraint therefore left a tombstone that blocks re-joining: accepting a
-- new invitation after removal tried to INSERT a fresh membership for the same
-- (org, user) pair → unique violation → HTTP 500 "Could not accept the
-- invitation".
--
-- Fix: replace the full-column constraint with a PARTIAL unique index scoped
-- to ACTIVE memberships (deleted_at IS NULL). This preserves the invariant
-- "at most one active membership per (organization, user)" while letting a
-- soft-deleted membership coexist with a new, active one after re-accept.
-- Soft-deleted rows are still excluded from every repository read by default
-- (DATA_MODEL.md §11 rule 5), so the re-invite AUTHZ-8 check and the members
-- list behave unchanged.
--
-- Fix forward: the original constraint is in 0002_tenant_tables.sql (merged);
-- do not edit it.
--
-- @see DATA_MODEL.md §4.2 — core_memberships
-- @see BUSINESS_RULES.md AUTHZ-7 — member removal is a soft delete

ALTER TABLE core_memberships
    DROP CONSTRAINT core_memberships_organization_id_user_id_key;

CREATE UNIQUE INDEX uq_core_memberships_active
    ON core_memberships (organization_id, user_id)
    WHERE deleted_at IS NULL;

COMMENT ON INDEX uq_core_memberships_active
    IS 'At most one ACTIVE membership per (organization, user). Soft-deleted memberships (removed members) do not block a re-invite (AUTHZ-7).';
