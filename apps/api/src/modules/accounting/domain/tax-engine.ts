import { ACCOUNTING_ERROR_CODE, AccountingDomainError } from './errors.js';
import type { TaxBasis, TaxType } from './tax-rate.entity.js';

export type { TaxBasis, TaxType };

/**
 * Centralized tax engine (ACC-11) — the single source of truth for computing
 * tax across POS, invoicing, and purchasing. Exact integer minor-unit math
 * ONLY (hard rule #3): every amount is a non-negative minor-units string and
 * every rate is an integer number of basis points (1% = 100 bp).
 *
 * Line-level rounding is authoritative (CUR-8): each line computes its tax
 * ONCE, and the document tax total is the SUM of the line taxes — never a
 * re-computed document-level rate. This guarantees the printed per-line tax
 * always adds up to the printed document tax.
 *
 * Bases (ACC-11):
 *  - exclusive:  tax = round(lineTotal × rateBp / 10000), grand = lineTotal + tax
 *  - inclusive:  tax = round(lineTotal × rateBp / (10000 + rateBp)),
 *                grand = lineTotal (the tax is embedded in the price)
 *
 * zero / exempt rates always compute tax 0 regardless of basis.
 */

/** The tax attributes a rate contributes to the computation. */
export interface TaxRateSpec {
  /** ACC-11: rate in basis points (1% = 100 bp). */
  rateBp: number;
  type: TaxType;
  taxBasis: TaxBasis;
}

/** The computed tax for one line. */
export interface LineTaxResult {
  /** The line's taxable amount (line total after discount), minor units. */
  lineTotalMinor: string;
  /** The line's tax amount, minor units. */
  taxAmountMinor: string;
  /** The line's grand total (taxable + tax), minor units. */
  lineGrandTotalMinor: string;
}

/** The aggregated tax result for a document (or a single line). */
export interface TaxCalculationResult {
  /** Σ line tax, minor units. */
  taxAmountMinor: string;
  /** Σ line grand totals, minor units. */
  grandTotalMinor: string;
  lines: LineTaxResult[];
}

/**
 * ACC-11: compute tax for a set of line subtotals under one rate.
 *
 * @param lines - Each element is a line's taxable amount (after discount) in
 *   non-negative minor units. Passed as strings; converted internally.
 * @param rate - The tax rate attributes (basis-points rate + type + basis).
 * @throws AccountingDomainError ACCOUNTING_TAX_RATE_INVALID for a malformed rate.
 */
export function calculateTaxes(lines: string[], rate: TaxRateSpec): TaxCalculationResult {
  if (!Number.isInteger(rate.rateBp) || rate.rateBp < 0) {
    throw new AccountingDomainError(
      ACCOUNTING_ERROR_CODE.TAX_RATE_INVALID,
      `Tax rate bp must be a non-negative integer, got ${rate.rateBp}.`,
      { rateBp: rate.rateBp },
    );
  }

  const results = lines.map((line) => calculateLineTax(line, rate));
  const tax = results.reduce((sum, line) => sum + BigInt(line.taxAmountMinor), 0n);
  const grand = results.reduce((sum, line) => sum + BigInt(line.lineGrandTotalMinor), 0n);

  return {
    taxAmountMinor: tax.toString(),
    grandTotalMinor: grand.toString(),
    lines: results,
  };
}

/**
 * ACC-11: compute the tax for a SINGLE line. `taxBp === 0` (zero/exempt) is a
 * fast path: no tax, grand = taxable.
 */
export function calculateLineTax(lineTotalMinor: string, rate: TaxRateSpec): LineTaxResult {
  if (!isNonNegativeMinor(lineTotalMinor)) {
    throw new AccountingDomainError(
      ACCOUNTING_ERROR_CODE.LINE_INVALID,
      `A tax line total must be a non-negative minor-units string, got "${lineTotalMinor}".`,
      { lineTotalMinor },
    );
  }
  if (!Number.isInteger(rate.rateBp) || rate.rateBp < 0) {
    throw new AccountingDomainError(
      ACCOUNTING_ERROR_CODE.TAX_RATE_INVALID,
      `Tax rate bp must be a non-negative integer, got ${rate.rateBp}.`,
      { rateBp: rate.rateBp },
    );
  }
  const taxable = BigInt(lineTotalMinor);
  const rateBp = BigInt(rate.rateBp);

  let tax: bigint;
  if (rate.type === 'exempt' || rate.type === 'zero' || rateBp === 0n) {
    tax = 0n;
  } else if (rate.taxBasis === 'inclusive') {
    // tax = round(lineTotal × rateBp / (10000 + rateBp)) — the tax is embedded.
    tax = (taxable * rateBp + (10000n + rateBp) / 2n) / (10000n + rateBp);
  } else {
    // exclusive: tax = round(lineTotal × rateBp / 10000)
    tax = (taxable * rateBp + 5000n) / 10000n;
  }

  // ACC-11: for an inclusive basis the price already contains the tax, so the
  // grand total is the line total itself; for exclusive the tax is added on.
  const grand = rate.taxBasis === 'inclusive' ? taxable : taxable + tax;
  return {
    lineTotalMinor: taxable.toString(),
    taxAmountMinor: tax.toString(),
    lineGrandTotalMinor: grand.toString(),
  };
}

function isNonNegativeMinor(value: string): boolean {
  return /^\d+$/.test(value);
}
