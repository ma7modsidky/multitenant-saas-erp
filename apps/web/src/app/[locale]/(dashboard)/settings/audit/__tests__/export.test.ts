// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import type { AuditLogEntry } from '@/lib/api/types';

// export.ts imports getAuditLog for its default fetchPage; tests always pass
// an explicit fetchPage, so the mock only neutralizes module side effects.
vi.mock('@/lib/api/resources', () => ({ getAuditLog: vi.fn() }));

import {
  auditEntryToRow,
  buildAuditCsv,
  CSV_COLUMNS,
  EXPORT_PAGE_SIZE,
  fetchAllAuditEntries,
  type AuditCsvContext,
} from '../export';

const CTX: AuditCsvContext = {
  locale: 'en-US',
  labels: { yes: 'Yes', no: 'No' },
  actionLabel: (action) => action.toLowerCase(),
  entityLabel: (type) => type.toUpperCase(),
  actorName: (userId) => (userId === null ? 'System' : 'Alice'),
};

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'e1',
    actorUserId: 'u1',
    actorType: 'user',
    action: 'UPDATE',
    entityType: 'stock_count',
    entityId: 'sc-1',
    before: null,
    after: null,
    ip: '127.0.0.1',
    correlationId: null,
    occurredAt: '2026-01-15T10:30:00.000Z',
    ...overrides,
  };
}

describe('buildAuditCsv', () => {
  it('prefixes a UTF-8 BOM and joins rows with CRLF (Excel-safe)', () => {
    const csv = buildAuditCsv(['A', 'B'], [['1', '2']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe('\uFEFFA,B\r\n1,2\r\n');
  });

  it('quotes cells containing commas, quotes, or newlines (RFC-4180)', () => {
    const csv = buildAuditCsv(['A', 'B', 'C'], [['a,b', 'say "hi"', 'line1\nline2']]);
    const row = csv.split('\r\n')[1]!;
    expect(row).toContain('"a,b"');
    expect(row).toContain('"say ""hi"""');
    expect(row).toContain('"line1\nline2"');
  });

  it('guards formula-like cells so spreadsheets never evaluate them (OWASP)', () => {
    const csv = buildAuditCsv(['A'], [['=SUM(A1)'], ['+1'], ['@cmd'], ['\t=cmd'], ['-5'], ['-']]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe("'=SUM(A1)");
    expect(lines[2]).toBe("'+1");
    expect(lines[3]).toBe("'@cmd");
    expect(lines[4]).toBe("'\t=cmd"); // leading tab is a formula vector too
    expect(lines[5]).toBe('-5'); // plain negative number stays untouched
    expect(lines[6]).toBe("'-");
  });
});

describe('auditEntryToRow', () => {
  it('maps an entry to the fixed column order with humanized labels', () => {
    const row = auditEntryToRow(
      makeEntry({
        before: { sku: 'A' },
        after: { sku: 'B', cost: { currency: 'USD', amountMinor: '180' }, isActive: true },
      }),
      CTX,
    );

    expect(row).toHaveLength(CSV_COLUMNS.length);
    expect(row[0]).toBe('2026-01-15T10:30:00.000Z'); // time stays ISO
    expect(row[1]).toBe('Alice'); // resolved actor name
    expect(row[2]).toBe('update'); // localized action label
    expect(row[3]).toBe('UPDATE'); // raw action code alongside
    expect(row[4]).toBe('STOCK_COUNT'); // localized entity label
    expect(row[5]).toBe('stock_count'); // raw entity type alongside
    expect(row[6]).toBe('sc-1'); // full entity id (never truncated in CSV)
    // Details use the same formatting as the UI: money → $1.80, boolean → Yes
    expect(row[7]).toContain('SKU: A → B');
    expect(row[7]).toContain('$1.80');
    expect(row[7]).toContain('Yes');
    expect(row[8]).toBe('127.0.0.1');
    expect(row[9]).toBe(''); // null correlation id
  });

  it('resolves system entries and hides ids recorded as unknown', () => {
    const row = auditEntryToRow(
      makeEntry({ actorUserId: null, entityId: 'unknown', action: 'LOGIN', entityType: 'user' }),
      CTX,
    );
    expect(row[1]).toBe('System');
    expect(row[6]).toBe('');
  });

  it('leaves details empty when no before/after snapshot was recorded', () => {
    const row = auditEntryToRow(makeEntry(), CTX);
    expect(row[7]).toBe('');
  });
});

describe('fetchAllAuditEntries', () => {
  it('walks pages at the API max pageSize until total is reached', async () => {
    const page1 = {
      entries: Array.from({ length: 200 }, (_, i) => makeEntry({ id: `p${i}` })),
      total: 250,
      page: 1,
      pageSize: 200,
    };
    const page2 = {
      entries: Array.from({ length: 50 }, (_, i) => makeEntry({ id: `p${200 + i}` })),
      total: 250,
      page: 2,
      pageSize: 200,
    };
    const fetchPage = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const all = await fetchAllAuditEntries('org-1', { entityType: 'product' }, fetchPage);

    expect(all).toHaveLength(250);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[0]![0]).toBe('org-1');
    expect(fetchPage.mock.calls[0]![1]).toMatchObject({ entityType: 'product', page: 1, pageSize: EXPORT_PAGE_SIZE });
    expect(fetchPage.mock.calls[1]![1]).toMatchObject({ page: 2, pageSize: EXPORT_PAGE_SIZE });
  });

  it('stops defensively when a page comes back empty (never spins)', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ entries: [], total: 1000, page: 1, pageSize: 200 });
    const all = await fetchAllAuditEntries('org-1', {}, fetchPage);
    expect(all).toHaveLength(0);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
