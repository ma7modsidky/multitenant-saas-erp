-- 0005_pipeline_owner_team.sql — Team-scoped pipelines (TEAM-1..6) so
-- different teams can run their own pipelines with their own stages.
--
-- crm_pipelines.owner_team_id follows the exact pattern of
-- 0004_owner_team.sql: a bare uuid column with NO cross-prefix FK —
-- core_teams belongs to the platform/core schema; validity is enforced at
-- the API layer via the TEAM_READ_PORT (store the id, validate through a
-- port). Fix forward: no merged migration is edited.
--
-- Semantics (CRM-17):
--   owner_team_id IS NULL  → org-wide pipeline (every member sees it)
--   owner_team_id IS NOT NULL → visible to that team's members + leaders
--                               and the org OWNER/ADMIN (GLOBAL ceiling)

ALTER TABLE crm_pipelines ADD COLUMN owner_team_id uuid;

-- Org leads the index so RLS + the visibility filter share one index scan.
CREATE INDEX idx_crm_pipelines_org_team ON crm_pipelines (organization_id, owner_team_id);

COMMENT ON COLUMN crm_pipelines.owner_team_id IS
  'CRM-17: owning team (core_teams id, no cross-prefix FK). NULL = org-wide; set = visible to the team, its leaders, and org admins.';
