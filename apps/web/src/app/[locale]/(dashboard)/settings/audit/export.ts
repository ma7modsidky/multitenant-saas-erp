/**
 * Pure CSV export helpers for the audit log page.
 *
 * The export mirrors the table's humanized presentation — localized entity
 * and action labels, formatted diff values ($1.80, localized dates, Yes/No) —
 * while keeping the raw codes (action/entity type) alongside for filtering in
 * a spreadsheet. No React here; callers pass translations and formatters in.
 */
import { getAuditLog, type AuditLogQueryParams } from '@/lib/api/resources';
import type { AuditLogEntry, AuditLogQueryResponse } from '@/lib/api/types';

import { changedFields, formatValue, humanizeKey } from './format';

/** API cap for the audit-log endpoint (PROGRESS Phase 2.8 — max 200/page). */
export const EXPORT_PAGE_SIZE = 200;

/** Filters accepted by the export — everything except the paging pair. */
export type AuditLogFilterParams = Omit<AuditLogQueryParams, 'page' | 'pageSize'>;

/** Fixed column order — the CSV headers and every row share this sequence. */
export type AuditCsvColumn =
  | 'time'
  | 'actor'
  | 'action'
  | 'actionCode'
  | 'entity'
  | 'entityType'
  | 'entityId'
  | 'details'
  | 'ip'
  | 'correlationId';

export const CSV_COLUMNS: readonly AuditCsvColumn[] = [
  'time',
  'actor',
  'action',
  'actionCode',
  'entity',
  'entityType',
  'entityId',
  'details',
  'ip',
  'correlationId',
];

/** i18n key for each column header (the page translates them via `t`). */
const COLUMN_HEADER_KEYS: Record<AuditCsvColumn, string> = {
  time: 'audit.time',
  actor: 'audit.actor',
  action: 'audit.action',
  actionCode: 'audit.actionCode',
  entity: 'audit.entity',
  entityType: 'audit.entityType',
  entityId: 'audit.entityId',
  details: 'audit.details',
  ip: 'audit.ipAddress',
  correlationId: 'audit.correlationId',
};

export function columnHeaderKey(column: AuditCsvColumn): string {
  return COLUMN_HEADER_KEYS[column];
}

/** Translations + formatters the row mapper needs (passed by the page). */
export interface AuditCsvContext {
  locale: string;
  labels: { yes: string; no: string };
  /** Localized action label (e.g. "Update"). */
  actionLabel: (action: string) => string;
  /** Localized entity label (e.g. "Stock count"). */
  entityLabel: (type: string) => string;
  /** Resolved actor display name; "System" for null actor ids. */
  actorName: (userId: string | null) => string;
}

/**
 * One entry → one CSV row, using the same humanized formatting as the table
 * and the detail dialog. The raw action/entity codes ride along for filtering.
 * `time` stays ISO-8601 (machine-sortable, locale-independent); a localized
 * display column would defeat the point of a data export.
 */
export function auditEntryToRow(entry: AuditLogEntry, ctx: AuditCsvContext): string[] {
  const cells: Record<AuditCsvColumn, string> = {
    time: entry.occurredAt,
    actor: ctx.actorName(entry.actorUserId),
    action: ctx.actionLabel(entry.action),
    actionCode: entry.action,
    entity: ctx.entityLabel(entry.entityType),
    entityType: entry.entityType,
    // Ids recorded as 'unknown' (or empty) add no value to an export.
    entityId: entry.entityId === '' || entry.entityId === 'unknown' ? '' : entry.entityId,
    details: changedFields(entry.before, entry.after)
      .map((row) => {
        const field = humanizeKey(row.key);
        const hasBefore = row.before !== null && row.before !== undefined;
        const hasAfter = row.after !== null && row.after !== undefined;
        if (hasBefore && hasAfter) {
          return `${field}: ${formatValue(row.before, ctx.locale, ctx.labels)} → ${formatValue(row.after, ctx.locale, ctx.labels)}`;
        }
        return `${field}: ${formatValue(hasAfter ? row.after : row.before, ctx.locale, ctx.labels)}`;
      })
      .join('; '),
    ip: entry.ip ?? '',
    correlationId: entry.correlationId ?? '',
  };
  return CSV_COLUMNS.map((column) => cells[column]);
}

/**
 * Fetch ALL entries matching the filters (not just the visible page) by
 * walking pages at the API's max pageSize. `fetchPage` is injectable for
 * tests; it defaults to the real resource function.
 */
export async function fetchAllAuditEntries(
  orgId: string,
  filters: AuditLogFilterParams,
  fetchPage: (orgId: string, params: AuditLogQueryParams) => Promise<AuditLogQueryResponse> = getAuditLog,
): Promise<AuditLogEntry[]> {
  const entries: AuditLogEntry[] = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;
  while (entries.length < total) {
    const response = await fetchPage(orgId, { ...filters, page, pageSize: EXPORT_PAGE_SIZE });
    entries.push(...response.entries);
    total = response.total;
    if (response.entries.length === 0) break; // defensive — never spin
    page += 1;
  }
  return entries;
}

/**
 * Cells starting with `=`, `+`, `@`, tab, CR, or `-` (not a plain negative
 * number) are prefixed with a single quote so spreadsheet apps never
 * interpret them as formulas (OWASP CSV-injection guard). RFC-4180 quoting:
 * wrap in double quotes when the value contains a comma, quote, or newline;
 * double inner quotes. UTF-8 BOM + CRLF so Excel opens the file correctly.
 */
function csvCell(raw: string): string {
  const value = /^[=+@\t\r]|^-(?!\d)/.test(raw) ? `'${raw}` : raw;
  const needsQuotes = /[",\r\n]/.test(value);
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize headers + rows to a BOM-prefixed CSV string. */
export function buildAuditCsv(headers: string[], rows: string[][]): string {
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
