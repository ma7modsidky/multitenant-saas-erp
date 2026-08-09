-- 0003_append_only.sql — pos_payments is append-only (POS-13, hard rule #8)
--
-- Payment records are immutable: a correction is a refund, never an edit.
-- Uses the same prevent_update_delete() function as core_audit_log
-- (packages/db migrations/core/0005_append_only.sql).

CREATE TRIGGER prevent_update_delete
    BEFORE UPDATE OR DELETE ON pos_payments
    FOR EACH ROW
    EXECUTE FUNCTION prevent_update_delete();
