-- 0001_init.sql — CRM module initial schema
--
-- @see DATA_MODEL.md §7 — CRM schema (`crm_`)
-- @see DATA_MODEL.md §3 — Universal column conventions (mandatory base columns)
-- @see BUSINESS_RULES.md §9 — CRM rules (DB-enforceable invariants)
--
-- Every table carries the mandatory base columns (id, organization_id,
-- created_at, updated_at, created_by, updated_by, deleted_at) except
-- crm_deal_stage_history, which is an APPEND-ONLY ledger (no updated_at,
-- no deleted_at — nothing may ever be edited or removed).
--
-- Module tables do NOT declare foreign keys into core_* (extractability —
-- cross-module validity is checked through ports). FKs within the module are
-- explicit and indexed. organization_id is the RLS key and is never FK'd to
-- core_organizations by design (same as the generator scaffold).
--
-- citext (case-insensitive text) is available: core 0001 creates the
-- extension. Emails use citext so the CRM-2 unique index is case-insensitive
-- ('Ada@x.com' and 'ada@x.com' are the same address), matching core_invitations.

-- ─── crm_companies ─────────────────────────────────────────────────────────
CREATE TABLE crm_companies (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    name            text NOT NULL,
    domain          text,
    industry        text,
    address         jsonb NOT NULL DEFAULT '{}',
    owner_user_id   uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_by      uuid,
    deleted_at      timestamptz
);

COMMENT ON TABLE  crm_companies           IS 'Organizations the tenant sells to.';
COMMENT ON COLUMN crm_companies.address   IS 'Structured address (free-form jsonb, keys per DATA_MODEL).';
COMMENT ON COLUMN crm_companies.owner_user_id IS 'Owning member id (core_users, no FK — module extractability).';

-- ─── crm_contacts ──────────────────────────────────────────────────────────
CREATE TABLE crm_contacts (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    uuid NOT NULL,
    first_name         text NOT NULL,
    last_name          text NOT NULL,
    email              citext,
    phone              text,
    company_id         uuid REFERENCES crm_companies(id),
    owner_user_id      uuid,
    preferred_locale   text,
    preferred_currency char(3),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid,
    updated_by         uuid,
    deleted_at         timestamptz,
    -- CRM-1: a contact requires at least one of email or phone.
    CONSTRAINT ck_crm_contacts_identity
        CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX idx_crm_contacts_company_id ON crm_contacts (company_id);
CREATE INDEX idx_crm_contacts_org_owner  ON crm_contacts (organization_id, owner_user_id);

COMMENT ON TABLE  crm_contacts IS 'People the tenant sells to.';
COMMENT ON CONSTRAINT ck_crm_contacts_identity ON crm_contacts IS 'CRM-1: requires at least one of email or phone.';

-- ─── crm_pipelines ─────────────────────────────────────────────────────────
CREATE TABLE crm_pipelines (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    name_i18n       jsonb NOT NULL DEFAULT '{}',
    is_default      boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_by      uuid,
    deleted_at      timestamptz
);

COMMENT ON TABLE  crm_pipelines       IS 'Deal pipelines (e.g. Sales, Support).';
COMMENT ON COLUMN crm_pipelines.name_i18n  IS 'Translatable name: {"en": "Sales", "ar": "المبيعات"}.';
COMMENT ON COLUMN crm_pipelines.is_default IS 'CRM-3: exactly one default pipeline per organization.';

-- ─── crm_pipeline_stages ───────────────────────────────────────────────────
CREATE TABLE crm_pipeline_stages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    pipeline_id     uuid NOT NULL REFERENCES crm_pipelines(id),
    name_i18n       jsonb NOT NULL DEFAULT '{}',
    position        integer NOT NULL,
    probability      integer NOT NULL DEFAULT 0
                      CHECK (probability BETWEEN 0 AND 100),
    is_won          boolean NOT NULL DEFAULT false,
    is_lost         boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_by      uuid,
    deleted_at      timestamptz
);

CREATE INDEX idx_crm_pipeline_stages_pipeline ON crm_pipeline_stages (pipeline_id);

-- Supporting unique for the composite FK on crm_deals(pipeline_id, stage_id).
CREATE UNIQUE INDEX uq_crm_pipeline_stages_pipeline_id
    ON crm_pipeline_stages (pipeline_id, id);

COMMENT ON TABLE  crm_pipeline_stages       IS 'Ordered stages within a pipeline.';
COMMENT ON COLUMN crm_pipeline_stages.name_i18n  IS 'Translatable stage name.';
COMMENT ON COLUMN crm_pipeline_stages.position   IS 'CRM-5: contiguous, unique per pipeline.';

-- ─── crm_deals ─────────────────────────────────────────────────────────────
CREATE TABLE crm_deals (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       uuid NOT NULL,
    title                 text NOT NULL,
    pipeline_id           uuid NOT NULL REFERENCES crm_pipelines(id),
    stage_id              uuid NOT NULL REFERENCES crm_pipeline_stages(id),
    contact_id            uuid REFERENCES crm_contacts(id),
    company_id            uuid REFERENCES crm_companies(id),
    -- Money pair (DATA_MODEL §5): value in the deal's own currency.
    value_amount_minor    bigint NOT NULL DEFAULT 0
                            CHECK (value_amount_minor >= 0),
    value_currency        char(3) NOT NULL,
    -- FX snapshot taken at write time when value_currency != base currency.
    exchange_rate         numeric(20,10),
    base_amount_minor     bigint,
    expected_close_date   date,
    status                text NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'won', 'lost')),
    closed_at             timestamptz,
    lost_reason_code      text,
    owner_user_id         uuid,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    created_by            uuid,
    updated_by            uuid,
    deleted_at            timestamptz,
    -- CRM-10: a deal must reference a contact or a company (at least one).
    CONSTRAINT ck_crm_deals_references
        CHECK (contact_id IS NOT NULL OR company_id IS NOT NULL),
    -- CRM-7: a lost deal requires a lost_reason_code.
    CONSTRAINT ck_crm_deals_lost_reason
        CHECK (status <> 'lost' OR lost_reason_code IS NOT NULL),
    -- CRM-9: a closed deal (won or lost) must have closed_at set.
    CONSTRAINT ck_crm_deals_closed_at
        CHECK (status = 'open' OR closed_at IS NOT NULL),
    -- The stage must belong to the deal's pipeline (composite FK).
    CONSTRAINT fk_crm_deals_pipeline_stage
        FOREIGN KEY (pipeline_id, stage_id)
        REFERENCES crm_pipeline_stages (pipeline_id, id)
);

CREATE INDEX idx_crm_deals_pipeline   ON crm_deals (pipeline_id);
CREATE INDEX idx_crm_deals_stage      ON crm_deals (stage_id);
CREATE INDEX idx_crm_deals_contact    ON crm_deals (contact_id);
CREATE INDEX idx_crm_deals_company    ON crm_deals (company_id);
CREATE INDEX idx_crm_deals_org_stage_status ON crm_deals (organization_id, stage_id, status);

COMMENT ON TABLE  crm_deals IS 'Opportunities.';
COMMENT ON COLUMN crm_deals.value_currency  IS 'ISO 4217. May differ from the org base currency (CRM-8).';
COMMENT ON COLUMN crm_deals.exchange_rate   IS 'Transaction currency -> org base currency at write time (CUR-5).';
COMMENT ON COLUMN crm_deals.base_amount_minor IS 'value_amount_minor converted to base currency at write time.';

-- ─── crm_deal_stage_history (APPEND-ONLY) ──────────────────────────────────
CREATE TABLE crm_deal_stage_history (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    deal_id          uuid NOT NULL REFERENCES crm_deals(id),
    from_stage_id    uuid REFERENCES crm_pipeline_stages(id),
    to_stage_id      uuid NOT NULL REFERENCES crm_pipeline_stages(id),
    moved_at         timestamptz NOT NULL DEFAULT now(),
    moved_by         uuid,
    duration_seconds bigint NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_deal_stage_history_deal ON crm_deal_stage_history (deal_id);
CREATE INDEX idx_crm_deal_stage_history_org  ON crm_deal_stage_history (organization_id, deal_id);

COMMENT ON TABLE  crm_deal_stage_history IS 'Append-only ledger of stage transitions (CRM-6). No UPDATE, no DELETE.';
COMMENT ON COLUMN crm_deal_stage_history.duration_seconds IS 'Elapsed duration in the previous stage (CRM-6).';

-- ─── crm_activities ────────────────────────────────────────────────────────
CREATE TABLE crm_activities (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    type            text NOT NULL,
    subject         text NOT NULL,
    due_at          timestamptz,
    completed_at    timestamptz,
    related_type    text,
    related_id      uuid,
    assigned_to     uuid,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_by      uuid,
    deleted_at      timestamptz,
    CONSTRAINT ck_crm_activities_type
        CHECK (type IN ('call', 'meeting', 'task', 'email')),
    CONSTRAINT ck_crm_activities_related
        CHECK ((related_type IS NULL AND related_id IS NULL)
            OR (related_type IS NOT NULL AND related_id IS NOT NULL))
);

CREATE INDEX idx_crm_activities_org_assigned_due ON crm_activities (organization_id, assigned_to, due_at);
CREATE INDEX idx_crm_activities_related          ON crm_activities (related_type, related_id);

COMMENT ON TABLE  crm_activities IS 'Calls, meetings, tasks, and email logs.';
COMMENT ON COLUMN crm_activities.assigned_to IS 'Active member id (core_users, no FK — CRM-14 checked in the domain).';

-- ─── crm_notes ─────────────────────────────────────────────────────────────
CREATE TABLE crm_notes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    body            text NOT NULL,
    related_type    text NOT NULL,
    related_id      uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_by      uuid,
    deleted_at      timestamptz
);

CREATE INDEX idx_crm_notes_related ON crm_notes (related_type, related_id);
CREATE INDEX idx_crm_notes_org     ON crm_notes (organization_id, related_type, related_id);

COMMENT ON TABLE crm_notes IS 'Free-text notes attached to contacts, companies, deals, or activities.';

-- ─── crm_tags ──────────────────────────────────────────────────────────────
CREATE TABLE crm_tags (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    name            text NOT NULL,
    color           text NOT NULL DEFAULT 'slate',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_by      uuid,
    deleted_at      timestamptz
);

COMMENT ON TABLE crm_tags IS 'Organization-scoped tags.';

-- ─── crm_taggables ─────────────────────────────────────────────────────────
CREATE TABLE crm_taggables (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    tag_id          uuid NOT NULL REFERENCES crm_tags(id),
    related_type    text NOT NULL,
    related_id      uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    UNIQUE (tag_id, related_type, related_id)
);

CREATE INDEX idx_crm_taggables_tag     ON crm_taggables (tag_id);
CREATE INDEX idx_crm_taggables_related ON crm_taggables (related_type, related_id);

COMMENT ON TABLE crm_taggables IS 'Polymorphic tag attachment (contacts, companies, deals, activities).';

-- ─── crm_attachments ───────────────────────────────────────────────────────
CREATE TABLE crm_attachments (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    storage_key     text NOT NULL,
    filename        text NOT NULL,
    mime_type       text NOT NULL,
    size_bytes      bigint NOT NULL CHECK (size_bytes >= 0),
    related_type    text NOT NULL,
    related_id      uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_by      uuid,
    deleted_at      timestamptz
);

CREATE INDEX idx_crm_attachments_related ON crm_attachments (related_type, related_id);
CREATE INDEX idx_crm_attachments_org     ON crm_attachments (organization_id, related_type, related_id);

COMMENT ON TABLE crm_attachments IS 'File references (storage key, not content).';

-- ─── Unique & business-rule indexes ─────────────────────────────────────────
-- Tag name unique per organization among non-deleted tags (soft-delete friendly).
CREATE UNIQUE INDEX uq_crm_tags_org_name
    ON crm_tags (organization_id, name)
    WHERE deleted_at IS NULL;
-- CRM-2: contact email unique per organization among non-deleted contacts.
CREATE UNIQUE INDEX uq_crm_contacts_org_email
    ON crm_contacts (organization_id, email)
    WHERE deleted_at IS NULL AND email IS NOT NULL;

-- CRM-3: exactly one default pipeline per organization.
CREATE UNIQUE INDEX uq_crm_pipelines_org_default
    ON crm_pipelines (organization_id)
    WHERE is_default AND deleted_at IS NULL;

-- CRM-4: exactly one is_won and exactly one is_lost stage per pipeline.
CREATE UNIQUE INDEX uq_crm_pipeline_stages_won
    ON crm_pipeline_stages (pipeline_id)
    WHERE is_won AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_crm_pipeline_stages_lost
    ON crm_pipeline_stages (pipeline_id)
    WHERE is_lost AND deleted_at IS NULL;

-- CRM-5: stage positions are unique within a pipeline.
CREATE UNIQUE INDEX uq_crm_pipeline_stages_position
    ON crm_pipeline_stages (pipeline_id, position)
    WHERE deleted_at IS NULL;

-- ─── updated_at triggers (function from core 0004) ─────────────────────────
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_companies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_pipelines
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_pipeline_stages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_deals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_activities
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_notes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_tags
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_attachments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Append-only protection for the stage history ledger (CRM-6) ────────────
-- Reuses the prevent_update_delete function from core 0005.
CREATE TRIGGER prevent_update_delete
    BEFORE UPDATE OR DELETE ON crm_deal_stage_history
    FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();

COMMENT ON TRIGGER prevent_update_delete ON crm_deal_stage_history
    IS 'CRM-6: stage history is append-only — no UPDATE, no DELETE.';
