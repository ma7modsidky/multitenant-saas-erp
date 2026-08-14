-- 0015_admin_grant_access_until.sql
-- Free admin grants with an optional end date (PLT-8).
--
-- A platform-admin full-access grant can be unlimited (NULL) or bounded by an
-- explicit `access_until` date. Grants are FREE: they never create a Stripe
-- item and are never billed. Paid modules are NOT governed by this column —
-- their period is the Stripe subscription's `current_period_end`.
--
-- A lapsed grant (active, no Stripe item, access_until in the past) is moved
-- to `expired` (read-only grace, BILL-3) by the nightly reconcile job
-- (BILL-14). The column is nullable, so no backfill is required.
--
-- @see docs/BUSINESS_RULES.md §4 (BILL-14) and §12 (PLT-8)

ALTER TABLE core_module_entitlements
    ADD COLUMN access_until timestamptz;

COMMENT ON COLUMN core_module_entitlements.access_until IS
    'Optional end date of a free admin grant (PLT-8). NULL = unlimited grant; paid modules use the Stripe subscription period instead. Lapsed grants move to expired via the nightly reconcile job (BILL-14).';
