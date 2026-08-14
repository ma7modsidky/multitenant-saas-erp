-- 0014_admin_blocked_state.sql
-- Admin "block until paid" entitlement state (PLT-8 extension).
--
-- Adds `blocked` to the core_module_entitlements.state CHECK constraint.
-- A blocked module grants NO access and NO trial — the organization can
-- only regain it via a paid subscription or an explicit admin grant.
-- No merged migration is edited (fix forward).
--
-- @see docs/BUSINESS_RULES.md §12 — Platform administration rules

ALTER TABLE core_module_entitlements
    DROP CONSTRAINT core_module_entitlements_state_check;

ALTER TABLE core_module_entitlements
    ADD CONSTRAINT core_module_entitlements_state_check
    CHECK (state IN ('available', 'trialing', 'active', 'past_due', 'expired', 'suspended', 'disabled', 'blocked'));

COMMENT ON COLUMN core_module_entitlements.state IS
    'available | trialing | active | past_due | expired | suspended | disabled | blocked — blocked is an admin gate (block until paid, PLT-8)';
