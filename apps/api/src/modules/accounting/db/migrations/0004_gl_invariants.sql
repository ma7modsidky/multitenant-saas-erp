-- 0004_gl_invariants.sql — DB-level backstops for the core GL invariants.
--
-- The domain layer enforces these first; these constraints/triggers are
-- defence in depth so a stray write can never corrupt the books.
--
--   ACC-1  every journal entry is balanced (total debits = total credits)
--   ACC-4  a line sets exactly one of debit/credit, both positive minor units
--   ACC-3  entry numbers sequential + gap-free per org (unique, allocated
--          atomically by the application — a failed post never consumes one)
--   ACC-9  cumulative payment allocations per invoice ≤ invoice total
--   ACC-10 cumulative credit-note amounts per invoice ≤ invoice net total
--
-- @see BUSINESS_RULES.md §13 — ACC-1/3/4/9/10

-- ─── ACC-4: one side per line, positive amounts ────────────────────────────
ALTER TABLE acc_journal_lines
  ADD CONSTRAINT ck_acc_journal_lines_one_side
  CHECK (
    (debit_amount_minor > 0 AND credit_amount_minor = 0)
    OR
    (credit_amount_minor > 0 AND debit_amount_minor = 0)
  );

-- ─── ACC-1: balanced entries ───────────────────────────────────────────────
-- A CONSTRAINT trigger (deferred to COMMIT) checks the entry's balance after
-- the whole batch of lines lands. It MUST be deferred: the application
-- persists the header then its lines one at a time, so after the first line
-- the entry is legitimately unbalanced mid-transaction. At commit the books
-- must balance — a stray line change that leaves an entry unbalanced rolls
-- the whole transaction back.
CREATE OR REPLACE FUNCTION acc_assert_entry_balanced()
RETURNS TRIGGER AS $$
DECLARE
    v_entry uuid;
    v_debit bigint;
    v_credit bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_entry := OLD.entry_id;
    ELSE
        v_entry := NEW.entry_id;
    END IF;

    SELECT COALESCE(SUM(debit_amount_minor), 0), COALESCE(SUM(credit_amount_minor), 0)
      INTO v_debit, v_credit
      FROM acc_journal_lines
     WHERE entry_id = v_entry;

    IF v_debit <> v_credit THEN
        RAISE EXCEPTION 'Journal entry % is unbalanced: debits=%, credits=% (ACC-1)',
            v_entry, v_debit, v_credit
            USING ERRCODE = '2F002';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER acc_assert_entry_balanced
    AFTER INSERT OR UPDATE OR DELETE ON acc_journal_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION acc_assert_entry_balanced();

COMMENT ON FUNCTION acc_assert_entry_balanced() IS 'Rejects any line change that leaves its journal entry unbalanced at commit (ACC-1).';
COMMENT ON TRIGGER acc_assert_entry_balanced ON acc_journal_lines IS 'DB backstop for ACC-1: debits must equal credits per entry, checked at commit.';

-- ─── ACC-9: allocations never exceed the invoice total ─────────────────────
CREATE OR REPLACE FUNCTION acc_assert_allocation_within_invoice()
RETURNS TRIGGER AS $$
DECLARE
    v_invoice uuid;
    v_invoice_total bigint;
    v_allocated bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_invoice := OLD.invoice_id;
    ELSE
        v_invoice := NEW.invoice_id;
    END IF;

    SELECT total_amount_minor INTO v_invoice_total
      FROM acc_invoices
     WHERE id = v_invoice;

    -- Guard against a missing invoice row (FK would catch it, but be safe).
    IF v_invoice_total IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    SELECT COALESCE(SUM(amount_minor), 0) INTO v_allocated
      FROM acc_payment_allocations
     WHERE invoice_id = v_invoice;

    IF v_allocated > v_invoice_total THEN
        RAISE EXCEPTION 'Invoice % allocations (%) exceed invoice total (%) (ACC-9)',
            v_invoice, v_allocated, v_invoice_total
            USING ERRCODE = '2F002';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acc_assert_allocation_within_invoice
    AFTER INSERT OR UPDATE OR DELETE ON acc_payment_allocations
    FOR EACH ROW
    EXECUTE FUNCTION acc_assert_allocation_within_invoice();

COMMENT ON FUNCTION acc_assert_allocation_within_invoice() IS 'Rejects a payment allocation that would push cumulative allocations over the invoice total (ACC-9).';
COMMENT ON TRIGGER acc_assert_allocation_within_invoice ON acc_payment_allocations IS 'DB backstop for ACC-9: cumulative allocations per invoice ≤ invoice total.';

-- ─── ACC-10: credit notes never exceed the invoice net total ───────────────
CREATE OR REPLACE FUNCTION acc_assert_credit_note_within_invoice()
RETURNS TRIGGER AS $$
DECLARE
    v_invoice uuid;
    v_invoice_total bigint;
    v_credited bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_invoice := OLD.invoice_id;
    ELSE
        v_invoice := NEW.invoice_id;
    END IF;

    SELECT total_amount_minor INTO v_invoice_total
      FROM acc_invoices
     WHERE id = v_invoice;
    IF v_invoice_total IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Only ISSUED credit notes count against the invoice (drafts are editable).
    SELECT COALESCE(SUM(cn.amount_minor), 0) INTO v_credited
      FROM acc_credit_notes cn
     WHERE cn.invoice_id = v_invoice AND cn.status = 'issued';

    IF v_credited > v_invoice_total THEN
        RAISE EXCEPTION 'Invoice % cumulative credit notes (%) exceed invoice total (%) (ACC-10)',
            v_invoice, v_credited, v_invoice_total
            USING ERRCODE = '2F002';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acc_assert_credit_note_within_invoice
    AFTER INSERT OR UPDATE OR DELETE ON acc_credit_notes
    FOR EACH ROW
    EXECUTE FUNCTION acc_assert_credit_note_within_invoice();

COMMENT ON FUNCTION acc_assert_credit_note_within_invoice() IS 'Rejects a credit note that would push cumulative issued credit notes over the invoice total (ACC-10).';
COMMENT ON TRIGGER acc_assert_credit_note_within_invoice ON acc_credit_notes IS 'DB backstop for ACC-10: cumulative credit notes per invoice ≤ invoice net total.';
