-- 0004_grn_overshoot.sql — GRN lines can never exceed the PO remaining (PUR-4)
--
-- The receiving use case already enforces this inside its transaction while
-- holding a row lock on the PO line (SELECT ... FOR UPDATE), so concurrent
-- GRNs for the same line cannot overshoot. This trigger is the DB backstop for
-- any direct write path: inserting/updating a pur_grn_lines row must not push
-- the cumulative received quantity past the PO line's ordered quantity.
--
-- @see BUSINESS_RULES.md §14 — PUR-4 (no overshoot under concurrency)

CREATE OR REPLACE FUNCTION pur_enforce_grn_quantity()
RETURNS TRIGGER AS $$
DECLARE
    v_ordered numeric(18,4);
    v_received numeric(18,4);
BEGIN
    -- Lock the PO line and read its ordered + already-received quantities.
    SELECT quantity, received_quantity INTO v_ordered, v_received
    FROM pur_po_lines
    WHERE id = NEW.po_line_id
    FOR UPDATE;

    IF v_ordered IS NULL THEN
        RAISE EXCEPTION 'pur_grn_lines.po_line_id % does not exist', NEW.po_line_id
            USING ERRCODE = '23503'; -- foreign_key_violation
    END IF;

    -- v_received is the projection; add this line's quantity. On UPDATE
    -- (should not happen in practice), subtract the old row first.
    IF TG_OP = 'UPDATE' THEN
        v_received := v_received - OLD.quantity;
    END IF;

    IF v_received + NEW.quantity > v_ordered THEN
        RAISE EXCEPTION 'GRN line would overshoot PO line %: received % + new % exceeds ordered % (PUR-4)',
            NEW.po_line_id, v_received, NEW.quantity, v_ordered
            USING ERRCODE = '2F002'; -- integrity constraint violation
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pur_enforce_grn_quantity
    BEFORE INSERT OR UPDATE ON pur_grn_lines
    FOR EACH ROW
    EXECUTE FUNCTION pur_enforce_grn_quantity();

COMMENT ON FUNCTION pur_enforce_grn_quantity() IS 'Rejects GRN lines that would push a PO line past its ordered quantity (PUR-4).';
COMMENT ON TRIGGER pur_enforce_grn_quantity ON pur_grn_lines IS 'Enforces PUR-4: a GRN line can never exceed the PO line remaining quantity.';
