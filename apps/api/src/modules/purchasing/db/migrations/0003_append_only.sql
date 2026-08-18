-- 0003_append_only.sql — pur_vendor_ledger is append-only (PUR-2)
--
-- The vendor ledger is the source of truth for accounts payable: a supplier's
-- balance is ALWAYS the signed sum of its entries — never a stored, editable
-- number. Corrections are new entries (a reversing debit note / payment), not
-- UPDATEs or DELETEs.
--
-- Implementation: a BEFORE UPDATE OR DELETE trigger that raises on any
-- mutation. There is no sanctioned exception — the ledger is written once.
--
-- @see BUSINESS_RULES.md §14 — PUR-2
-- @see hard rule #8 — never UPDATE/DELETE a ledger table

CREATE OR REPLACE FUNCTION pur_prevent_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'pur_vendor_ledger row % is append-only — corrections are new entries, never UPDATE/DELETE (PUR-2).',
        OLD.id
        USING ERRCODE = '2F002'; -- integrity constraint violation
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pur_prevent_ledger_mutation
    BEFORE UPDATE OR DELETE ON pur_vendor_ledger
    FOR EACH ROW
    EXECUTE FUNCTION pur_prevent_ledger_mutation();

COMMENT ON FUNCTION pur_prevent_ledger_mutation() IS 'Rejects UPDATE/DELETE on pur_vendor_ledger: the AP ledger is append-only (PUR-2).';
COMMENT ON TRIGGER pur_prevent_ledger_mutation ON pur_vendor_ledger IS 'Enforces PUR-2: the vendor ledger is the source of truth for accounts payable and can only be appended to.';
