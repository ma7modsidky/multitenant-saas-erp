-- ─── crm_contacts.secondary_phone ──────────────────────────────────────────
-- Forward-only: optional secondary phone number for a contact. Free-form text
-- (phone format is validated at the API boundary, like `phone`).

ALTER TABLE crm_contacts ADD COLUMN secondary_phone text;

COMMENT ON COLUMN crm_contacts.secondary_phone IS 'Optional secondary phone number.';
