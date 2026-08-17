-- 0016_entitlement_features.sql
-- Plan-gated module features (PLAN.md §7.0.1).
--
-- Each entitlement row now carries the enabled FEATURE set for its module
-- (e.g. `['advanced_coa', 'e_invoicing']` for accounting). Billing computes
-- the set at enable time and on plan change from the MODULE_FEATURES catalog
-- in @modubiz/contracts; the entitlement row remains the runtime authority
-- (BILL-4). Module use cases enforce server-side from this column (OPS-8,
-- ACC-16) — a feature that is not in the set behaves as ABSENT.
--
-- The column defaults to an empty array, so no backfill is required: modules
-- without declared features are unaffected, and an enabled module whose
-- entitlement predates this migration behaves as if every feature were off
-- until billing reconciles the set (next enable/plan change).
--
-- @see docs/BUSINESS_RULES.md §13 (ACC-16) and §14 (PUR-12)
-- @see packages/contracts/src/module/features.ts — MODULE_FEATURES catalog

ALTER TABLE core_module_entitlements
    ADD COLUMN features jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN core_module_entitlements.features IS
    'Enabled plan-gated feature keys for this module (short keys, e.g. ["advanced_coa", "e_invoicing"]). Computed by billing from MODULE_FEATURES at enable and on plan change; the runtime authority for server-side feature gating (ACC-16/OPS-8).';
