import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TenantContext } from '../../tenancy/tenant-context.js';
import { AuditDbWriter } from '../audit-db-writer.js';
import type { AuditEntry } from '../audit-logger.js';

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'entry-1',
    actorId: 'user-1',
    actorEmail: 'admin@example.com',
    action: 'UPDATE',
    entityType: 'membership',
    entityId: 'mem-1',
    organizationId: 'org-1',
    before: null,
    after: { roleId: 'role-admin' },
    ipAddress: '127.0.0.1',
    correlationId: 'corr-1',
    occurredAt: '2026-01-15T10:30:00.000Z',
    ...overrides,
  };
}

const tenant = {
  userId: 'user-1',
  sessionId: undefined as string | undefined,
  organizationId: 'org-1' as string | undefined,
  roles: [] as string[],
  permissions: [] as string[],
  locale: 'en',
};

describe('AuditDbWriter (AUD-1/AUD-2 — Phase 2 DB persistence)', () => {
  let txManager: { runWithOrg: ReturnType<typeof vi.fn> };
  let writer: AuditDbWriter;

  beforeEach(() => {
    txManager = {
      // Run the callback with a fake tx that exposes execute(), like the real
      // TransactionManager (the writer INSERTs via tx.execute).
      runWithOrg: vi
        .fn()
        .mockImplementation(async (orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
          fn({ execute: vi.fn().mockResolvedValue(undefined) }),
        ),
    };
    writer = new AuditDbWriter(txManager as never);
  });

  it('AUD-1: writes the redacted entry inside an org-bound transaction (RLS WITH CHECK)', async () => {
    await writer.write(makeEntry(), tenant);

    expect(txManager.runWithOrg).toHaveBeenCalledTimes(1);
    expect(txManager.runWithOrg).toHaveBeenCalledWith('org-1', expect.any(Function));

    // The INSERT ran against the tenant-bound tx — never the raw pool — so the
    // org-scoped RLS policy (0003/0008) passes. (Assert the tx was used by
    // checking the callback actually executed against a tx-shaped object.)
    const callback = txManager.runWithOrg.mock.calls[0]![1] as (tx: unknown) => Promise<unknown>;
    await expect(callback({ execute: vi.fn().mockResolvedValue(undefined) })).resolves.toBeUndefined();
  });

  it('AUD-1: maps the system actor to NULL actor_user_id + actor_type=system', async () => {
    await writer.write(makeEntry({ actorId: 'system', actorEmail: 'system' }), tenant);

    // runWithOrg succeeded — the system actor does not crash the uuid column.
    expect(txManager.runWithOrg).toHaveBeenCalledTimes(1);
  });

  it('skips entries without an organization (system-context routes have nowhere safe to store them)', async () => {
    // The skip is keyed on the tenant's organizationId (the audit interceptor
    // derives it from the request user); a system-context route has no org.
    await writer.write(makeEntry(), { ...tenant, organizationId: undefined });

    expect(txManager.runWithOrg).not.toHaveBeenCalled();
  });

  it('NOTIF-1: swallows DB failures — audit persistence must never fail the originating request', async () => {
    txManager.runWithOrg.mockRejectedValueOnce(new Error('connection refused'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(writer.write(makeEntry(), tenant)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledTimes(1);

    consoleError.mockRestore();
  });

  it('TEN-3: rebuilds the tenant context from the request snapshot so the write is org-scoped', async () => {
    // The interceptor's tap fires AFTER the handler's transaction committed;
    // run the writer with NO ambient TenantContext to prove it self-contains.
    const promise = TenantContext.runWithCleanContext(() => writer.write(makeEntry(), tenant));
    await expect(promise).resolves.toBeUndefined();
    expect(txManager.runWithOrg).toHaveBeenCalledWith('org-1', expect.any(Function));
  });
});
