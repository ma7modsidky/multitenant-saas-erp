-- 0001_init.sql — inventory module initial schema
-- Follow DATA_MODEL.md §2 exactly: mandatory base columns on every tenant table.
-- Replace the example table below with the module's real schema.

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Partial unique indexes (per organization) go here.
