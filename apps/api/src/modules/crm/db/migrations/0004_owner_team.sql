-- 0004_owner_team.sql — Team ownership columns for CRM records (TEAM-2).
--
-- Adds an optional team dimension alongside the existing per-user owner:
--   crm_companies.owner_team_id / crm_contacts.owner_team_id / crm_deals.owner_team_id
--   crm_activities.assigned_team_id (alongside assigned_to)
--
-- Per the module-extraction rule (crm 0001 header) these are bare uuid
-- columns with NO cross-prefix FK — core_teams belongs to the platform/core
-- schema; validity is enforced at the API layer via the TEAM_READ_PORT
-- (store the id, validate through a port). Fix forward: no merged migration
-- is edited.

ALTER TABLE crm_companies   ADD COLUMN owner_team_id uuid;
ALTER TABLE crm_contacts    ADD COLUMN owner_team_id uuid;
ALTER TABLE crm_deals       ADD COLUMN owner_team_id uuid;
ALTER TABLE crm_activities  ADD COLUMN assigned_team_id uuid;

-- Scope filters resolve by team within the tenant (AUTHZ-9); org leads every
-- index so RLS + team filtering share one index scan.
CREATE INDEX idx_crm_companies_org_owner_team  ON crm_companies  (organization_id, owner_team_id);
CREATE INDEX idx_crm_contacts_org_owner_team   ON crm_contacts   (organization_id, owner_team_id);
CREATE INDEX idx_crm_deals_org_owner_team      ON crm_deals      (organization_id, owner_team_id);
CREATE INDEX idx_crm_activities_org_assign_team ON crm_activities (organization_id, assigned_team_id);

-- Deals Kanban "unassigned pool": team-assigned but no individual owner yet.
CREATE INDEX idx_crm_deals_org_pool ON crm_deals (organization_id, owner_user_id)
    WHERE owner_user_id IS NULL AND owner_team_id IS NOT NULL AND deleted_at IS NULL;
