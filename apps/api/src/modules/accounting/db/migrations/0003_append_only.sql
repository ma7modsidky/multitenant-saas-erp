-- 0003_append_only.sql — posted journal entries are immutable (ACC-2)
--
-- Draft entries are editable; the moment an entry is POSTED it becomes
-- append-only — no UPDATE, no DELETE. Corrections are reversal entries that
-- reference the original; the original's status becomes `reversed`.
--
-- Implementation: a trigger that raises on UPDATE/DELETE of a row whose
-- status is NOT 'draft', with exactly ONE sanctioned exception: the
-- `posted → reversed` status flip that records the ACC-2 reversal (the
-- original's immutable content is untouched — only the status and the
-- `reversed_by_entry_id` pointer change). Everything else on a posted row
-- raises.
--
-- @see BUSINESS_RULES.md §13 — ACC-2
-- @see hard rule #8 — never modify a merged migration, never UPDATE/DELETE a ledger

CREATE OR REPLACE FUNCTION acc_prevent_posted_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Drafts may be deleted; posted/reversed rows never.
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'acc_journal_entries row % is not a draft (status=%). Posted entries are immutable — corrections require a reversal entry (ACC-2).',
                OLD.id, OLD.status
                USING ERRCODE = '2F002'; -- integrity constraint violation
        END IF;
        RETURN OLD;
    END IF;

    -- UPDATE path.
    IF OLD.status = 'draft' THEN
        -- Draft lifecycle: editable, and the draft → posted flip is the post.
        RETURN NEW;
    END IF;

    -- Posted/reversed rows: the ONLY sanctioned mutation is the ACC-2
    -- reversal status flip (posted → reversed), which stamps the reversal
    -- pointer. Reversed rows are fully frozen — a reversed entry can never be
    -- touched again.
    IF OLD.status = 'posted' AND NEW.status = 'reversed' AND NEW.reversed_by_entry_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'acc_journal_entries row % (status=%) is immutable; corrections require a reversal entry (ACC-2).',
        OLD.id, OLD.status
        USING ERRCODE = '2F002'; -- integrity constraint violation
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acc_prevent_posted_mutation
    BEFORE UPDATE OR DELETE ON acc_journal_entries
    FOR EACH ROW
    EXECUTE FUNCTION acc_prevent_posted_mutation();

COMMENT ON FUNCTION acc_prevent_posted_mutation() IS 'Rejects UPDATE/DELETE on posted or reversed journal entries, except the sanctioned posted→reversed reversal flip (ACC-2). Drafts remain editable.';
COMMENT ON TRIGGER acc_prevent_posted_mutation ON acc_journal_entries IS 'Enforces ACC-2: posted entries are immutable; corrections are reversal entries.';
