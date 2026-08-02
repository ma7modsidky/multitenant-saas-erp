import { describe, expect, it, vi } from 'vitest';

import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { QueryAuditLogUseCase } from '../application/query-audit-log.use-case.js';
import type { AuditLogRepository } from '../ports/index.js';

function createMockRepo(): AuditLogRepository {
  return {
    query: vi.fn().mockResolvedValue({
      entries: [
        {
          id: 'log-1',
          actorUserId: 'user-1',
          actorType: 'user',
          action: 'user.login',
          entityType: 'session',
          entityId: 'sess-1',
          before: null,
          after: null,
          ip: '127.0.0.1',
          correlationId: 'corr-1',
          occurredAt: new Date('2026-01-15T10:30:00Z'),
        },
      ],
      total: 1,
    }),
  };
}

function createUseCase(repo: AuditLogRepository): QueryAuditLogUseCase {
  const txManager = {
    // Run the callback with a fake tx, like the real TransactionManager —
    // core_audit_log is RLS-protected, so reads MUST run inside the
    // tenant-bound transaction (TEN-3 regression) or they fail closed.
    run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
  };
  return new QueryAuditLogUseCase(repo, txManager as never);
}

const runInContext = <T>(fn: () => Promise<T>) =>
  TenantContext.run(
    {
      userId: 'user-1',
      sessionId: 'session-1',
      organizationId: 'org-1',
      roles: [],
      permissions: [],
      locale: 'en',
    },
    fn,
  );

describe('QueryAuditLogUseCase', () => {
  it('RLS/TEN-3: queries the audit log inside the tenant-bound transaction (regression: raw-pool read returned zero rows)', async () => {
    const repo = createMockRepo();
    const txManager = {
      run: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn('tx')),
    };
    const useCase = new QueryAuditLogUseCase(repo, txManager as never);

    await runInContext(() => useCase.execute({ organizationId: 'org-1' }));

    // The repo must be called WITH the tenant-bound tx, never on the raw pool.
    const call = (repo.query as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, unknown];
    expect(call[1]).toBe('tx');
    expect(txManager.run).toHaveBeenCalledTimes(1);
  });

  it('defaults to page 1 and pageSize 50', async () => {
    const repo = createMockRepo();
    const useCase = createUseCase(repo);

    const result = await runInContext(() => useCase.execute({ organizationId: 'org-1' }));

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
    expect(repo.query).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', limit: 50, offset: 0 }),
      'tx',
    );
  });

  it('caps pageSize at 200', async () => {
    const repo = createMockRepo();
    const useCase = createUseCase(repo);

    const result = await runInContext(() => useCase.execute({ organizationId: 'org-1', pageSize: 500 }));

    expect(result.pageSize).toBe(200);
    expect(repo.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }), 'tx');
  });

  it('calculates offset correctly', async () => {
    const repo = createMockRepo();
    const useCase = createUseCase(repo);

    await runInContext(() => useCase.execute({ organizationId: 'org-1', page: 3, pageSize: 25 }));

    expect(repo.query).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 50 }), 'tx');
  });

  it('passes optional filters to the repository', async () => {
    const repo = createMockRepo();
    const useCase = createUseCase(repo);

    await runInContext(() =>
      useCase.execute({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        entityType: 'membership',
        entityId: 'mem-1',
        action: 'update',
        fromDate: '2026-01-01',
        toDate: '2026-01-31',
      }),
    );

    expect(repo.query).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        actorUserId: 'user-1',
        entityType: 'membership',
        entityId: 'mem-1',
        action: 'update',
        fromDate: '2026-01-01',
        toDate: '2026-01-31',
        limit: 50,
        offset: 0,
      },
      'tx',
    );
  });

  it('converts occurredAt Date to ISO string', async () => {
    const repo = createMockRepo();
    const useCase = createUseCase(repo);

    const result = await runInContext(() => useCase.execute({ organizationId: 'org-1' }));

    expect(result.entries[0]!.occurredAt).toBe('2026-01-15T10:30:00.000Z');
  });

  it('handles null fields in entries', async () => {
    const repo: AuditLogRepository = {
      query: vi.fn().mockResolvedValue({
        entries: [
          {
            id: 'log-2',
            actorUserId: null,
            actorType: 'system',
            action: 'system.startup',
            entityType: 'server',
            entityId: 'srv-1',
            before: null,
            after: null,
            ip: null,
            correlationId: null,
            occurredAt: new Date('2026-01-01T00:00:00Z'),
          },
        ],
        total: 1,
      }),
    };

    const useCase = createUseCase(repo);
    const result = await runInContext(() => useCase.execute({ organizationId: 'org-1' }));

    expect(result.entries[0]!.actorUserId).toBeNull();
    expect(result.entries[0]!.ip).toBeNull();
  });

  it('returns total, page, and pageSize in result', async () => {
    const repo: AuditLogRepository = {
      query: vi.fn().mockResolvedValue({ entries: [], total: 42 }),
    };

    const useCase = createUseCase(repo);
    const result = await runInContext(() => useCase.execute({ organizationId: 'org-1', page: 2, pageSize: 10 }));

    expect(result.total).toBe(42);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(result.entries).toEqual([]);
  });

  it('does not pass undefined filter keys when not provided', async () => {
    const repo = createMockRepo();
    const useCase = createUseCase(repo);

    await runInContext(() => useCase.execute({ organizationId: 'org-1' }));

    const filterArg = (repo.query as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(filterArg).not.toHaveProperty('actorUserId');
    expect(filterArg).not.toHaveProperty('entityType');
    expect(filterArg).not.toHaveProperty('entityId');
    expect(filterArg).not.toHaveProperty('action');
    expect(filterArg).not.toHaveProperty('fromDate');
    expect(filterArg).not.toHaveProperty('toDate');
  });
});
