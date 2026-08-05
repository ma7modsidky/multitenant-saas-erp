-- 0003_append_only.sql — inv_stock_movements is append-only (INV-1)
--
-- The ledger is the single source of truth for stock: no UPDATE, no DELETE.
-- Mistakes are corrected with a compensating movement. Uses the same
-- prevent_update_delete() function as core_audit_log (packages/db
-- migrations/core/0005_append_only.sql).

CREATE TRIGGER prevent_update_delete
    BEFORE UPDATE OR DELETE ON inv_stock_movements
    FOR EACH ROW
    EXECUTE FUNCTION prevent_update_delete();
