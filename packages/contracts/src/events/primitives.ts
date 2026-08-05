// Shared event payload primitives.
//
// Money is always integer minor units (DATA_MODEL §5 M1). In a JSON event
// payload a bigint would lose precision, so amounts travel as decimal strings —
// the same representation `Money` uses when JSON-serialized
// (packages/money/src/money.ts).
import { z } from 'zod';

/** Integer minor units as a decimal string (e.g. "250000" = 2500.00). */
export const minorUnitsString = z.string().regex(/^\d+$/, 'minor units must be a non-negative integer string');

/** ISO 4217 currency code, uppercase 3 letters. */
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'currency must be an uppercase ISO 4217 code');

/**
 * Fixed-point decimal as a string (e.g. "3.6725") — the JSON-safe form of a
 * `numeric(20,10)` column. Never a JS float, never scientific notation.
 */
export const decimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'decimal must be a plain decimal string (no floats, no exponents)');
