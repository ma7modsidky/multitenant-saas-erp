-- 0006_auth_lockout.sql
-- Add login-lockout columns to core_users (AUTH-7).
--
-- The domain entity and repositories already model these fields; the
-- original 0001 migration predated the lockout rule. Fix forward:
-- existing rows start with zero failures and no active lock.
--
-- @see AUTH-7 — Login is rate-limited; 10 consecutive failures lock the account
-- @see DATA_MODEL.md §4.1 — core_users

ALTER TABLE core_users
    ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN locked_until timestamptz;

COMMENT ON COLUMN core_users.failed_login_attempts IS 'Consecutive failed login attempts for rate-limiting (AUTH-7).';
COMMENT ON COLUMN core_users.locked_until IS 'Timestamp until which the account is temporarily locked after repeated failures (AUTH-7). NULL when not locked.';
