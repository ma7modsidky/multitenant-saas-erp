import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AuditBeforeStateRegistry } from '../audit-before-state.js';
import { AuditInterceptor, extractEntityIdFromResponse } from '../audit.interceptor.js';

// ─── extractEntityIdFromResponse ────────────────────────────────────────────

describe('extractEntityIdFromResponse (AUD-1: real entity ids for CREATE routes)', () => {
  it('returns the entityType-specific id key from the { data } envelope', () => {
    expect(extractEntityIdFromResponse('product', { data: { productId: 'p-1', variantId: 'v-1' } })).toBe('p-1');
    expect(extractEntityIdFromResponse('sale', { data: { saleId: 's-1', receiptNumber: 'R1' } })).toBe('s-1');
    expect(extractEntityIdFromResponse('invitation', { data: { invitationId: 'i-1' } })).toBe('i-1');
  });

  it('falls back to a generic *Id key when the type has no specific mapping', () => {
    expect(extractEntityIdFromResponse('widget', { data: { widgetId: 'w-1' } })).toBe('w-1');
  });

  it('prefers the mapped key over the generic fallback when both exist', () => {
    // stock_movement responses carry transferOutId + transferInId — the map
    // pins the deterministic out-id instead of taking the first *Id match.
    expect(
      extractEntityIdFromResponse('stock_movement', { data: { transferOutId: 'out-1', transferInId: 'in-1' } }),
    ).toBe('out-1');
  });

  it('returns null when the response carries no id (caller falls back to :id or unknown)', () => {
    expect(extractEntityIdFromResponse('role', { data: { message: 'Role updated.' } })).toBeNull();
    expect(extractEntityIdFromResponse('sale', undefined)).toBeNull();
    expect(extractEntityIdFromResponse('sale', { data: null })).toBeNull();
    expect(extractEntityIdFromResponse('sale', { data: 42 })).toBeNull();
  });
});

// ─── AuditInterceptor ───────────────────────────────────────────────────────

function makeInterceptor(
  overrides: {
    metadata?: Record<string, unknown>;
    beforeLoader?: { load: (id: string, tx: unknown) => Promise<Record<string, unknown> | null> };
    txRun?: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  } = {},
) {
  const { metadata = { action: 'CREATE', entityType: 'product', captureAfter: true }, beforeLoader, txRun } = overrides;

  const auditLogger = { record: vi.fn().mockResolvedValue({ id: 'entry-1' }) };
  const reflector = { get: () => metadata };
  const dbWriter = null;

  const registry = beforeLoader ? new AuditBeforeStateRegistry() : null;
  if (beforeLoader && registry) {
    registry.register('product', beforeLoader);
  }

  const txManager = txRun ? { run: txRun } : null;

  const interceptor = new AuditInterceptor(
    auditLogger as never,
    reflector as never,
    dbWriter,
    registry,
    txManager as never,
  );

  const request = {
    user: { sub: 'user-1', email: 'u@example.com', organizationId: 'org-1', locale: 'en' },
    params: {},
    headers: {},
    ip: '127.0.0.1',
    body: { sku: 'NEW', price: { amountMinor: '290', currency: 'USD' } },
  };

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;

  return { interceptor, auditLogger, request, context };
}

describe('AuditInterceptor — entity id + before-state capture (AUD-1)', () => {
  it('derives the entity id from the response envelope for CREATE routes (POST has no :id)', async () => {
    const { interceptor, auditLogger, context } = makeInterceptor();
    const observable = await interceptor.intercept(context, {
      handle: () => of({ data: { productId: 'p-9' } }),
    } as never);

    await new Promise<void>((resolve) => observable.subscribe({ complete: () => resolve() }));

    expect(auditLogger.record).toHaveBeenCalledTimes(1);
    expect(auditLogger.record.mock.calls[0]![0].entityId).toBe('p-9');
  });

  it('falls back to the :id route param for UPDATE routes whose response has no id', async () => {
    const { interceptor, auditLogger, request, context } = makeInterceptor({
      metadata: { action: 'UPDATE', entityType: 'role' },
    });
    request.params = { id: 'role-1' };

    const observable = await interceptor.intercept(context, { handle: () => of({ data: { message: 'ok' } }) } as never);
    await new Promise<void>((resolve) => observable.subscribe({ complete: () => resolve() }));

    expect(auditLogger.record.mock.calls[0]![0].entityId).toBe('role-1');
  });

  it('logs "unknown" only when neither the response nor the params carry an id', async () => {
    const { interceptor, auditLogger, context } = makeInterceptor({ metadata: { action: 'OTHER', entityType: 'x' } });

    const observable = await interceptor.intercept(context, { handle: () => of({ data: {} }) } as never);
    await new Promise<void>((resolve) => observable.subscribe({ complete: () => resolve() }));

    expect(auditLogger.record.mock.calls[0]![0].entityId).toBe('unknown');
  });

  it('captures the pre-mutation state through the registry in a tenant-bound tx', async () => {
    const beforeRow = { sku: 'OLD', cost: { currency: 'USD', amountMinor: '100' } };
    const txRun = vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute: vi.fn() }));
    const beforeLoader = { load: vi.fn().mockResolvedValue(beforeRow) };

    const { interceptor, auditLogger, request, context } = makeInterceptor({
      metadata: { action: 'UPDATE', entityType: 'product', captureBefore: true, captureAfter: true },
      beforeLoader,
      txRun,
    });
    request.params = { id: 'p-1' };

    const observable = await interceptor.intercept(context, {
      handle: () => of({ data: { productId: 'p-1' } }),
    } as never);
    await new Promise<void>((resolve) => observable.subscribe({ complete: () => resolve() }));

    expect(txRun).toHaveBeenCalledTimes(1);
    expect(beforeLoader.load).toHaveBeenCalledWith('p-1', expect.anything());
    expect(auditLogger.record.mock.calls[0]![0].before).toEqual(beforeRow);
    expect(auditLogger.record.mock.calls[0]![0].after).toBeDefined();
  });

  it('skips the before-state read when no loader is registered for the entity type', async () => {
    const { interceptor, auditLogger, request, context } = makeInterceptor({
      metadata: { action: 'UPDATE', entityType: 'product', captureBefore: true },
      // no beforeLoader → the registry is null (nothing registered)
      txRun: vi.fn(),
    });
    request.params = { id: 'p-1' };

    const observable = await interceptor.intercept(context, {
      handle: () => of({ data: { productId: 'p-1' } }),
    } as never);
    await new Promise<void>((resolve) => observable.subscribe({ complete: () => resolve() }));

    // before is absent (exactOptionalPropertyTypes) and the request completed.
    expect(auditLogger.record.mock.calls[0]![0].before).toBeUndefined();
  });

  it('NOTIF-1: a failing before-state read degrades to null and never fails the request', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const txRun = vi.fn().mockRejectedValue(new Error('db down'));
    const beforeLoader = { load: vi.fn() };

    const { interceptor, auditLogger, request, context } = makeInterceptor({
      metadata: { action: 'UPDATE', entityType: 'product', captureBefore: true },
      beforeLoader,
      txRun,
    });
    request.params = { id: 'p-1' };

    const observable = await interceptor.intercept(context, {
      handle: () => of({ data: { productId: 'p-1' } }),
    } as never);
    await new Promise<void>((resolve) => observable.subscribe({ complete: () => resolve() }));

    expect(auditLogger.record).toHaveBeenCalledTimes(1);
    expect(auditLogger.record.mock.calls[0]![0].before).toBeUndefined();
    consoleError.mockRestore();
  });
});
