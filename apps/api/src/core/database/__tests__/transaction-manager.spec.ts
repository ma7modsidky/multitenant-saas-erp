import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

import { TenantContext } from '../tenant-context.js';
import { TransactionManager } from '../transaction-manager.js';

// ─── Test data helper ────────────────────────────────────────────────────

const makeContext = (overrides: Partial<{ userId: string; organizationId: string | undefined }> = {}) => ({
  userId: overrides.userId ?? 'user-1',
  sessionId: undefined,
  // Preserve an explicit `undefined` (org-less context): `?? 'org-1'`
  // would silently swallow it, which is exactly the case under test.
  organizationId: 'organizationId' in overrides ? overrides.organizationId : 'org-1',
  roles: [] as string[],
  permissions: [] as string[],
  locale: 'en',
});

// ─── Mocks ────────────────────────────────────────────────────────────────

function createMockDb(): PostgresJsDatabase {
  return {
    transaction: vi.fn(),
  } as unknown as PostgresJsDatabase;
}

function createMockTx(): PostgresJsDatabase {
  return {
    execute: vi.fn(),
  } as unknown as PostgresJsDatabase;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('TransactionManager', () => {
  describe('TEN-3: tenant context binding', () => {
    it('opens a transaction when run() is called with tenant context', async () => {
      const mockDb = createMockDb();
      const mockTx = createMockTx();
      const manager = new TransactionManager(mockDb);

      vi.mocked(mockDb.transaction).mockImplementation(async (cb: any) => cb(mockTx));

      const result = await TenantContext.run(makeContext(), async () => manager.run(async () => 'done'));

      expect(result).toBe('done');
      expect(mockDb.transaction).toHaveBeenCalledOnce();
    });

    it('calls SET LOCAL for organization_id inside the transaction', async () => {
      const mockDb = createMockDb();
      const mockTx = createMockTx();
      const manager = new TransactionManager(mockDb);

      vi.mocked(mockDb.transaction).mockImplementation(async (cb: any) => cb(mockTx));

      await TenantContext.run(makeContext({ organizationId: 'org-abc-123' }), async () => manager.run(async () => {}));

      expect(mockTx.execute).toHaveBeenCalledTimes(2);
    });

    it('calls SET LOCAL for user_id inside the transaction', async () => {
      const mockDb = createMockDb();
      const mockTx = createMockTx();
      const manager = new TransactionManager(mockDb);

      vi.mocked(mockDb.transaction).mockImplementation(async (cb: any) => cb(mockTx));

      await TenantContext.run(makeContext({ userId: 'user-xyz' }), async () => manager.run(async () => {}));

      expect(mockTx.execute).toHaveBeenCalledTimes(2);
    });

    it('makes both SET LOCAL calls in a single transaction', async () => {
      const mockDb = createMockDb();
      const mockTx = createMockTx();
      const manager = new TransactionManager(mockDb);

      vi.mocked(mockDb.transaction).mockImplementation(async (cb: any) => cb(mockTx));

      await TenantContext.run(makeContext(), async () => manager.run(async () => {}));

      expect(mockTx.execute).toHaveBeenCalledTimes(2);
      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    });

    it('TEN-4: leaves app.current_organization_id UNSET when the context has no org (no empty-string binding)', async () => {
      const mockDb = createMockDb();
      const mockTx = createMockTx();
      const manager = new TransactionManager(mockDb);

      vi.mocked(mockDb.transaction).mockImplementation(async (cb: any) => cb(mockTx));

      // Freshly signed-up user: no organizationId in the token yet.
      await TenantContext.run(makeContext({ organizationId: undefined }), async () => manager.run(async () => {}));

      // Only app.current_user_id is bound — never an empty-string org id,
      // which would crash RLS policies casting current_setting(...)::uuid.
      expect(mockTx.execute).toHaveBeenCalledTimes(1);
      const sqlCall = vi.mocked(mockTx.execute).mock.calls[0]?.[0] as { queryChunks?: unknown[] } | undefined;
      // drizzle SQL.queryChunks shape: [{ value: [rawSqlFragments...] }, <bound param>, { value: [...] }].
      // Raw SQL text lives in the `value` arrays; string chunks are bound params.
      const sqlText = (sqlCall?.queryChunks ?? [])
        .filter(
          (chunk): chunk is { value: string[] } =>
            typeof chunk === 'object' && chunk !== null && Array.isArray((chunk as { value?: unknown }).value),
        )
        .map((chunk) => chunk.value.join(''))
        .join('');
      expect(sqlText).not.toContain('current_organization_id');
      expect(sqlText).toContain('current_user_id');
    });

    it('returns the callback result from the transaction', async () => {
      const mockDb = createMockDb();
      const mockTx = createMockTx();
      const manager = new TransactionManager(mockDb);

      vi.mocked(mockDb.transaction).mockImplementation(async (cb: any) => cb(mockTx));

      const result = await TenantContext.run(makeContext(), async () =>
        manager.run(async () => ({ id: 'result-1', value: 42 })),
      );

      expect(result).toEqual({ id: 'result-1', value: 42 });
    });
  });

  describe('TEN-3: fail-closed without tenant context', () => {
    it('throws an error when run() is called without tenant context', async () => {
      const mockDb = createMockDb();
      const manager = new TransactionManager(mockDb);

      await expect(manager.run(async () => {})).rejects.toThrow('Cannot run transaction without tenant context');
    });

    it('does not open a transaction when tenant context is missing', async () => {
      const mockDb = createMockDb();
      const manager = new TransactionManager(mockDb);

      try {
        await manager.run(async () => {});
      } catch {
        // Expected
      }

      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });

  describe('TenantContext (from core/tenancy via re-export)', () => {
    it('provides tenant data within the context scope', async () => {
      const result = await TenantContext.run(makeContext(), async () => TenantContext.getCurrent());

      expect(result).toMatchObject({
        userId: 'user-1',
        organizationId: 'org-1',
      });
    });

    it('returns undefined outside a context scope', () => {
      expect(TenantContext.getCurrent()).toBeUndefined();
    });

    it('isolates nested context scopes', async () => {
      const outer = await TenantContext.run(makeContext({ userId: 'outer', organizationId: 'org-outer' }), async () => {
        const inner = await TenantContext.run(makeContext({ userId: 'inner', organizationId: 'org-inner' }), async () =>
          TenantContext.getCurrent(),
        );
        return { outerContext: TenantContext.getCurrent(), innerContext: inner };
      });

      expect(outer.outerContext?.userId).toBe('outer');
      expect(outer.innerContext?.userId).toBe('inner');
    });

    it('getOrganizationId() returns the org id', async () => {
      await TenantContext.run(makeContext(), async () => {
        expect(TenantContext.getOrganizationId()).toBe('org-1');
      });
    });

    it('getOrganizationId() returns undefined outside a context scope', () => {
      expect(TenantContext.getOrganizationId()).toBeUndefined();
    });

    it('getUserId() returns the user id', async () => {
      await TenantContext.run(makeContext(), async () => {
        expect(TenantContext.getUserId()).toBe('user-1');
      });
    });

    it('getUserId() returns undefined outside a context scope', () => {
      expect(TenantContext.getUserId()).toBeUndefined();
    });
  });
});
