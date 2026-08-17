-- 0017_entitlement_features_fix.sql
-- Unwrap double-encoded `features` jsonb values on core_module_entitlements.
--
-- The pre-fix write path stored `JSON.stringify(features)` through a `::jsonb`
-- cast. postgres-js re-serializes a STRING parameter through the jsonb cast,
-- so the stored value became a jsonb STRING containing the JSON-encoded array
-- text (e.g. the text `["advanced_coa","e_invoicing"]` wrapped as a JSON
-- string) instead of a jsonb ARRAY. Feature gating reads `Array.isArray`
-- (ACC-16 / PUR-12, PLAN §7.0.1), so those rows always reported an empty
-- feature set and every plan-gated feature failed closed.
--
-- `features #>> '{}'` extracts a jsonb string's text content; casting it back
-- to jsonb produces the intended array. Rows already stored in the correct
-- shape (arrays, including the `'[]'::jsonb` column default) are untouched —
-- only `jsonb_typeof = 'string'` rows are repaired.
--
-- @see PLAN.md §7.0.1 — Plan-gated feature mechanism
-- @see docs/BUSINESS_RULES.md §13 (ACC-16)

UPDATE core_module_entitlements
SET features = (features #>> '{}')::jsonb,
    updated_at = NOW()
WHERE jsonb_typeof(features) = 'string';
