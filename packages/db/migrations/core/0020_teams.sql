-- 0020_teams.sql — Core teams + team memberships (TEAM-1..TEAM-4).
--
-- Teams are tenant-scoped coordination groups used for record ownership
-- (CRM owner_team_id columns live in the owning modules' migrations) and for
-- scoped data access (OWN/TEAM/GLOBAL — BUSINESS_RULES AUTHZ-9).
--
-- Conventions followed here:
-- - Base columns + soft delete like core_memberships (DATA_MODEL §3).
-- - RLS with the mandatory NULLIF wrapper (0008 house style): any ACTIVE
--   member of the tenant can read teams (needed for pickers); writes are
--   gated by `platform:teams:manage` at the API layer.
-- - Invitations carry pre-selected team ids; acceptance provisions the
--   memberships (an invited user has no account yet, so the join cannot be
--   created at invite time).

-- ─── Tables ─────────────────────────────────────────────────────────────────

CREATE TABLE core_teams (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES core_organizations(id),
    name            text NOT NULL,
    description     text,
    leader_user_id  uuid REFERENCES core_users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_by      uuid,
    deleted_at      timestamptz
);

CREATE TABLE core_team_memberships (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES core_organizations(id),
    team_id         uuid NOT NULL REFERENCES core_teams(id),
    user_id         uuid NOT NULL REFERENCES core_users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_by      uuid,
    deleted_at      timestamptz
);

-- Invited-but-not-yet-accepted team assignments (array of team uuids).
ALTER TABLE core_invitations ADD COLUMN team_ids jsonb NOT NULL DEFAULT '[]';

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX idx_core_teams_organization_id ON core_teams (organization_id);
CREATE INDEX idx_core_teams_leader_user_id ON core_teams (leader_user_id);
-- Team names are unique within an organization among non-deleted teams.
CREATE UNIQUE INDEX uq_core_teams_active_name
    ON core_teams (organization_id, name)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_core_team_memberships_organization_id ON core_team_memberships (organization_id);
CREATE INDEX idx_core_team_memberships_team_id ON core_team_memberships (team_id);
CREATE INDEX idx_core_team_memberships_user_id ON core_team_memberships (user_id);
-- One active membership per (team, user); re-add after soft delete is allowed.
CREATE UNIQUE INDEX uq_core_team_memberships_active
    ON core_team_memberships (organization_id, team_id, user_id)
    WHERE deleted_at IS NULL;

-- ─── Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE core_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_teams FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core_teams
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE core_team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_team_memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON core_team_memberships
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
