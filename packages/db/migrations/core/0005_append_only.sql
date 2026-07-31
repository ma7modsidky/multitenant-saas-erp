-- 0005_append_only.sql
-- Append-only protection for ledger tables.
--
-- Tables that must never have rows UPDATEd or DELETEd get a trigger
-- that raises an exception on any UPDATE or DELETE attempt.
--
-- This is defence in depth — the application layer also prevents
-- these operations by design, but the database enforces it.
--
-- Affected tables:
--   - core_audit_log  (immutable audit trail)
--   - core_outbox      (durable event queue)
--
-- @see DATA_MODEL.md §3 — Hard schema rules (rule #5)
-- @see DATA_MODEL.md §4.2 — core_audit_log, core_outbox

-- ─── Shared prevent functions ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prevent_update_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Table % is append-only. No UPDATE or DELETE allowed.', TG_TABLE_NAME
        USING ERRCODE = '2F002'; -- integrity constraint violation
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Table % does not allow DELETE. Rows are never removed.', TG_TABLE_NAME
        USING ERRCODE = '2F002'; -- integrity constraint violation
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION prevent_update_delete() IS 'Raises an exception on UPDATE or DELETE. Used to enforce full append-only semantics on ledger tables.';
COMMENT ON FUNCTION prevent_delete() IS 'Raises an exception on DELETE only. Allows UPDATE for mutable metadata (e.g. published_at).';

-- ─── core_audit_log ─────────────────────────────────────────────────────────
-- Fully append-only: no UPDATE, no DELETE. Audit trails must never change.
CREATE TRIGGER prevent_update_delete
    BEFORE UPDATE OR DELETE ON core_audit_log
    FOR EACH ROW
    EXECUTE FUNCTION prevent_update_delete();

COMMENT ON TRIGGER prevent_update_delete ON core_audit_log IS 'Ensures core_audit_log is fully append-only (no UPDATE or DELETE).';

-- ─── core_outbox ────────────────────────────────────────────────────────────
-- DELETE-protected only, NOT UPDATE-protected.
-- The outbox publisher needs to UPDATE rows to set:
--   - published_at   (after successful publishing)
--   - attempts       (on each retry)
--   - failed_reason  (when dead-lettered)
CREATE TRIGGER prevent_delete
    BEFORE DELETE ON core_outbox
    FOR EACH ROW
    EXECUTE FUNCTION prevent_delete();

COMMENT ON TRIGGER prevent_delete ON core_outbox IS 'Prevents row deletion from core_outbox. UPDATE is allowed for publishing metadata.';
