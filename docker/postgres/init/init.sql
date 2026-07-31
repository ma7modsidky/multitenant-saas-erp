-- ModuBiz Postgres initialization
-- Creates the non-owner application role that RLS applies to.
-- Per docs/DATA_MODEL.md §1: the app connects as modubiz_app (NOBYPASSRLS),
-- the migration runner connects as modubiz_owner (bypasses RLS).

-- The modubiz_owner role is created by the POSTGRES_USER env var in docker-compose.
-- Here we create the app role and grant it the necessary privileges.

CREATE ROLE modubiz_app LOGIN PASSWORD 'modubiz_app_password' NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO modubiz_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO modubiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO modubiz_app;

-- Ensure future tables created by modubiz_owner are accessible to modubiz_app
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO modubiz_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO modubiz_app;

-- Create a read-only analytics role (for BI/reporting on read replica)
CREATE ROLE modubiz_analytics LOGIN PASSWORD 'modubiz_analytics_password' NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO modubiz_analytics;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO modubiz_analytics;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO modubiz_analytics;
