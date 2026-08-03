-- 0002_rls.sql — RLS for CRM tables
--
-- Every CRM table is tenant-owned and gets the standard tenant_isolation
-- policy, EXACTLY as specified in DATA_MODEL §2 (copy this exactly).
--
-- The NULLIF(current_setting(...), '') wrapper is mandatory (not optional):
-- Postgres resets custom GUCs (app.current_organization_id) to the EMPTY
-- STRING after any transaction that set them, so the raw cast would crash
-- with "invalid input syntax for type uuid: """ on the next org-less query.
-- NULLIF normalizes unset (NULL) and reset ('') to NULL → predicate is NULL
-- → zero rows, fail-closed (TEN-3). See core migration 0008 for the story.
--
-- @see DATA_MODEL.md §2 — The RLS pattern (copy this exactly)

-- ─── crm_companies ─────────────────────────────────────────────────────────
ALTER TABLE crm_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_companies FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON crm_companies
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── crm_contacts ──────────────────────────────────────────────────────────
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON crm_contacts
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── crm_pipelines ─────────────────────────────────────────────────────────
ALTER TABLE crm_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipelines FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON crm_pipelines
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── crm_pipeline_stages ───────────────────────────────────────────────────
ALTER TABLE crm_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipeline_stages FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON crm_pipeline_stages
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── crm_deals ─────────────────────────────────────────────────────────────
ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deals FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON crm_deals
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── crm_deal_stage_history (append-only ledger) ───────────────────────────
ALTER TABLE crm_deal_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deal_stage_history FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON crm_deal_stage_history
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── crm_activities ────────────────────────────────────────────────────────
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON crm_activities
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── crm_notes ─────────────────────────────────────────────────────────────
ALTER TABLE crm_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_notes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON crm_notes
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── crm_tags ──────────────────────────────────────────────────────────────
ALTER TABLE crm_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_tags FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON crm_tags
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── crm_taggables ─────────────────────────────────────────────────────────
ALTER TABLE crm_taggables ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_taggables FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON crm_taggables
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- ─── crm_attachments ───────────────────────────────────────────────────────
ALTER TABLE crm_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_attachments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON crm_attachments
    FOR ALL
    TO modubiz_app
    USING      (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
