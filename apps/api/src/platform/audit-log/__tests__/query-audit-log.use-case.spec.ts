import { describe, expect, it, vi } from 'vitest';

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

describe('QueryAuditLogUseCase', () => {
  it('defaults to page 1 and pageSize 50', async () => {
    const repo = createMockRepo();
    const useCase = new QueryAuditLogUseCase(repo);

    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
    expect(repo.query).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', limit: 50, offset: 0 }),
    );
  });

  it('caps pageSize at 200', async () => {
    const repo = createMockRepo();
    const useCase = new QueryAuditLogUseCase(repo);

    const result = await useCase.execute({ organizationId: 'org-1', pageSize: 500 });

    expect(result.pageSize).toBe(200);
    expect(repo.query).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200 }),
    );
  });

  it('calculates offset correctly', async () => {
    const repo = createMockRepo();
    const useCase = new QueryAuditLogUseCase(repo);

    await useCase.execute({ organizationId: 'org-1', page: 3, pageSize: 25 });

    expect(repo.query).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, offset: 50 }),
    );
  });

  it('passes optional filters to the repository', async () => {
    const repo = createMockRepo();
    const useCase = new QueryAuditLogUseCase(repo);

    await useCase.execute({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      entityType: 'membership',
      entityId: 'mem-1',
      action: 'update',
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
    });

    expect(repo.query).toHaveBeenCalledWith({
      organizationId: 'org-1',
      actorUserId: 'user-1',
      entityType: 'membership',
      entityId: 'mem-1',
      action: 'update',
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
      limit: 50,
      offset: 0,
    });
  });

  it('converts occurredAt Date to ISO string', async () => {
    const repo = createMockRepo();
    const useCase = new QueryAuditLogUseCase(repo);

    const result = await useCase.execute({ organizationId: 'org-1' });

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

    const useCase = new QueryAuditLogUseCase(repo);
    const result = await useCase.execute({ organizationId: 'org-1' });

    expect(result.entries[0]!.actorUserId).toBeNull();
    expect(result.entries[0]!.ip).toBeNull();
  });

  it('returns total, page, and pageSize in result', async () => {
    const repo: AuditLogRepository = {
      query: vi.fn().mockResolvedValue({ entries: [], total: 42 }),
    };

    const useCase = new QueryAuditLogUseCase(repo);
    const result = await useCase.execute({ organizationId: 'org-1', page: 2, pageSize: 10 });

    expect(result.total).toBe(42);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(result.entries).toEqual([]);
  });

  it('does not pass undefined filter keys when not provided', async () => {
    const repo = createMockRepo();
    const useCase = new QueryAuditLogUseCase(repo);

    await useCase.execute({ organizationId: 'org-1' });

    const filterArg = (repo.query as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(filterArg).not.toHaveProperty('actorUserId');
    expect(filterArg).not.toHaveProperty('entityType');
    expect(filterArg).not.toHaveProperty('entityId');
    expect(filterArg).not.toHaveProperty('action');
    expect(filterArg).not.toHaveProperty('fromDate');
    expect(filterArg).not.toHaveProperty('toDate');
  });
});
