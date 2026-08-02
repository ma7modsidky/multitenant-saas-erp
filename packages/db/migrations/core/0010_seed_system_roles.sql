-- 0010_seed_system_roles.sql
-- Backfill the five standard system roles (OWNER, ADMIN, MANAGER, MEMBER,
-- VIEWER) for organizations created before CreateOrganizationUseCase seeded
-- the full system-role set (it previously seeded only OWNER).
--
-- Forward-only data migration (AGENTS.md rule 8 — never edit merged
-- migrations). Idempotent: an org that already has a role with the same key
-- is skipped, so re-running is safe and orgs created after this migration
-- are unaffected (their roles come from the use case).
--
-- System-role *permissions* are code-defined (SYSTEM_ROLE_PERMISSIONS +
-- the role-matrix endpoint); only the role rows are persisted per org.
--
-- @see BUSINESS_RULES.md §3 — Role matrix
-- @see apps/api/src/platform/organizations/application/create-organization.use-case.ts

INSERT INTO core_roles
  (id, organization_id, key, name_i18n, description, is_system, created_at, updated_at, created_by, updated_by)
SELECT
  gen_random_uuid(), o.id, r.key, r.name_i18n, r.description, TRUE, NOW(), NOW(), NULL, NULL
FROM core_organizations o
CROSS JOIN (VALUES
  ('owner',
   '{"en":"Owner","ar":"المالك","fr":"Propriétaire","es":"Propietario"}'::jsonb,
   'Organization owner with full administrative access.'),
  ('admin',
   '{"en":"Admin","ar":"مدير","fr":"Administrateur","es":"Administrador"}'::jsonb,
   'Administrator with platform-level management rights.'),
  ('manager',
   '{"en":"Manager","ar":"مشرف","fr":"Gestionnaire","es":"Gerente"}'::jsonb,
   'Manages module configuration and data.'),
  ('member',
   '{"en":"Member","ar":"عضو","fr":"Membre","es":"Miembro"}'::jsonb,
   'Standard member with data read/write access.'),
  ('viewer',
   '{"en":"Viewer","ar":"مشاهد","fr":"Observateur","es":"Observador"}'::jsonb,
   'Read-only access to module data.')
) AS r(key, name_i18n, description)
WHERE NOT EXISTS (
  SELECT 1 FROM core_roles existing
  WHERE existing.organization_id = o.id AND existing.key = r.key
);
