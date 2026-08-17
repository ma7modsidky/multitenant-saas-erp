-- 0004_movement_types.sql — add Phase 7.0 movement types (supplier_return,
-- cost_adjustment) and the cost_adjustment quantity-0 exemption.
--
-- Forward migration (never edit merged migrations — fix forward):
--   - `supplier_return`  — goods returned to a supplier (PUR-11); negative qty.
--   - `cost_adjustment`  — bill cost variance (PUR-9); quantity 0, value only.
--     INV-3 is amended in the domain + DB: this type is the ONLY zero-quantity
--     movement; it adjusts the moving average without changing on-hand.
--
-- The original constraints were created inline in 0001_init.sql, so the type
-- CHECK was auto-named `inv_stock_movements_type_check` (Postgres column-CHECK
-- naming) and the quantity CHECK was explicitly named `ck_inv_movements_non_zero`.
-- DROP IF EXISTS keeps this idempotent-safe if a renamed constraint exists.

ALTER TABLE inv_stock_movements
  DROP CONSTRAINT IF EXISTS inv_stock_movements_type_check;

ALTER TABLE inv_stock_movements
  ADD CONSTRAINT ck_inv_movements_type CHECK (type IN (
    'receipt', 'sale', 'return', 'transfer_in', 'transfer_out',
    'adjustment', 'count_correction', 'write_off',
    'supplier_return', 'cost_adjustment'
  ));

ALTER TABLE inv_stock_movements
  DROP CONSTRAINT IF EXISTS ck_inv_movements_non_zero;

-- INV-3 (amended): non-zero quantity, except cost_adjustment (value-only).
ALTER TABLE inv_stock_movements
  ADD CONSTRAINT ck_inv_movements_quantity CHECK (quantity <> 0 OR type = 'cost_adjustment');
