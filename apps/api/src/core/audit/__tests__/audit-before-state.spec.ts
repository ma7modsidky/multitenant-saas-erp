import { describe, expect, it } from 'vitest';

import { AuditBeforeStateRegistry, rowToCamel, tableRowLoader } from '../audit-before-state.js';

// ─── Registry (AUD-1 wiring) ────────────────────────────────────────────────

describe('AuditBeforeStateRegistry', () => {
  it('registers and resolves a loader per entity type', async () => {
    const registry = new AuditBeforeStateRegistry();
    const loader = { load: async () => ({ sku: 'ABC' }) };

    registry.register('product', loader);

    expect(registry.has('product')).toBe(true);
    expect(registry.has('sale')).toBe(false);
    await expect(registry.load('product', 'p-1', {})).resolves.toEqual({ sku: 'ABC' });
  });

  it('returns null for unregistered entity types (fail soft — never throws)', async () => {
    const registry = new AuditBeforeStateRegistry();
    await expect(registry.load('unknown_entity', 'x', {})).resolves.toBeNull();
  });

  it('rejects a duplicate registration for the same entity type', () => {
    const registry = new AuditBeforeStateRegistry();
    registry.register('product', { load: async () => null });

    expect(() => registry.register('product', { load: async () => null })).toThrow(
      'Audit before-state loader for entity "product" is already registered.',
    );
  });
});

// ─── rowToCamel (before/after key parity) ───────────────────────────────────

describe('rowToCamel', () => {
  it('converts snake_case DB keys to the camelCase of request DTOs', () => {
    expect(
      rowToCamel({
        name_i18n: { en: 'Cola' },
        amount_minor: '180',
        organization_id: 'org-1',
        created_at: new Date('2026-01-01T00:00:00Z'),
      }),
    ).toEqual({
      nameI18n: { en: 'Cola' },
      amountMinor: '180',
      organizationId: 'org-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
  });

  it('leaves already-camelCase keys untouched and preserves values', () => {
    expect(rowToCamel({ id: 'x', sku: 'ABC', isActive: true })).toEqual({ id: 'x', sku: 'ABC', isActive: true });
  });
});

// ─── tableRowLoader (SELECT by id inside the tenant tx) ─────────────────────

describe('tableRowLoader', () => {
  it('SELECTs the row by id and passes the table as an identifier chunk', async () => {
    const loader = tableRowLoader('inv_products');
    let executed: unknown;
    const tx = {
      execute: async (query: unknown) => {
        executed = query;
        return [{ id: 'p-1', name_i18n: { en: 'Cola' } }];
      },
    };

    await expect(loader.load('p-1', tx as never)).resolves.toEqual({ id: 'p-1', nameI18n: { en: 'Cola' } });

    // The table name rides as its OWN chunk (sql.identifier), so the driver
    // quotes it at parameterization time — it is never raw-inlined into a
    // text chunk (no SQL injection surface for module-supplied names).
    const chunks = (executed as { queryChunks?: Array<{ value: unknown }> }).queryChunks ?? [];
    const values = chunks.map((c) => c.value);
    expect(values).toContain('inv_products');
    const textChunks = values.filter((v): v is string[] => Array.isArray(v)).flat();
    expect(textChunks.some((t) => t.includes('inv_products'))).toBe(false);
  });

  it('returns null when no row matches (deleted entity or fail-closed RLS)', async () => {
    const loader = tableRowLoader('pos_sales');
    const tx = { execute: async () => [] };

    await expect(loader.load('missing', tx as never)).resolves.toBeNull();
  });
});
