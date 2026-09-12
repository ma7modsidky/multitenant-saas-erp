/**
 * Shared CSV helpers (RFC-4180 quoting + OWASP CSV-injection guard + BOM/CRLF
 * so Excel opens files correctly). Extracted from the audit-log export so any
 * feature can produce safe spreadsheet downloads without duplicating the
 * escaping rules.
 */

/**
 * Cells starting with `=`, `+`, `@`, tab, CR, or `-` (not a plain negative
 * number) are prefixed with a single quote so spreadsheet apps never interpret
 * them as formulas. RFC-4180 quoting: wrap in double quotes when the value
 * contains a comma, quote, or newline; double inner quotes.
 */
function csvCell(raw: string): string {
  const value = /^[=+@\t\r]|^-(?!\d)/.test(raw) ? `'${raw}` : raw;
  const needsQuotes = /[",\r\n]/.test(value);
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize headers + rows to a BOM-prefixed CSV string. */
export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Trigger a browser download of `filename` with the CSV contents. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
