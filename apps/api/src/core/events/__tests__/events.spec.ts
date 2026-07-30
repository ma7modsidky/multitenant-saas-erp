import { describe, expect, it, beforeEach, vi } from 'vitest';

import { EventEmitter2EventBus } from '../event-emitter.adapter.js';
import { HandleEvent, HANDLE_EVENT_KEY } from '../handle-event.decorator.js';
import { InMemoryOutboxStore } from '../outbox-store.js';

// ─── Minimal EventEmitter2 mock ────────────────────────────────────────────
// We create a minimal mock of EventEmitter2 instead of importing from
// @nestjs/event-emitter because Vite has difficulty resolving the
// onpm-linked package in test context. The mock implements only the
// methods used by EventEmitter2EventBus.

interface MockListener {
  event: string;

  handler: (...args: any[]) => any;
}

function createMockEmitter() {
  const listeners: MockListener[] = [];

  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      listeners.push({ event, handler });
    }),
    emitAsync: vi.fn(async (event: string, ...args: unknown[]): Promise<unknown[]> => {
      const results: unknown[] = [];
      for (const listener of listeners) {
        if (listener.event === event || listener.event === '*') {
          try {
            // eslint-disable-next-line no-await-in-loop
            const result = await listener.handler(...args);
            results.push(result);
          } catch (error) {
            results.push(error);
          }
        } else if (listener.event.includes('*')) {
          // Simple wildcard match: 'test.*' matches 'test.event.v1'
          const pattern = listener.event.replace('*', '.*');
          if (new RegExp(`^${pattern}$`).test(event)) {
            try {
              // eslint-disable-next-line no-await-in-loop
              const result = await listener.handler(...args);
              results.push(result);
            } catch (error) {
              results.push(error);
            }
          }
        }
      }
      return results;
    }),
    removeListener: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      const idx = listeners.findIndex((l) => l.event === event && l.handler === handler);
      if (idx >= 0) {
        listeners.splice(idx, 1);
      }
    }),
    _listeners: listeners,
  };
}

// ─── Test helpers ──────────────────────────────────────────────────────────

function createTestEventBus(): EventEmitter2EventBus {
  const emitter = createMockEmitter();
  return new EventEmitter2EventBus(emitter as never);
}

function createTestEvent(overrides: Record<string, unknown> = {}) {
  return {
    name: 'test.event.v1',
    payload: { id: '123', value: 'test' },
    aggregateId: 'agg-1',
    occurredAt: new Date().toISOString(),
    correlationId: 'corr-1',
    organizationId: 'org-1',
    ...overrides,
  };
}

// ─── EventEmitter2EventBus ─────────────────────────────────────────────────

describe('EventEmitter2EventBus', () => {
  let bus: EventEmitter2EventBus;

  beforeEach(() => {
    bus = createTestEventBus();
  });

  describe('publish', () => {
    it('dispatches an event to registered listeners', async () => {
      const handler = vi.fn();
      bus.on('test.event.v1', handler);

      const event = createTestEvent();
      await bus.publish(event);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('passes the event payload to the listener', async () => {
      const handler = vi.fn();
      bus.on('test.event.v1', handler);

      const event = createTestEvent();
      await bus.publish(event);

      // The handler receives the event data
      const firstCall = handler.mock.calls[0];
      expect(firstCall).toBeDefined();

      const calledWith = firstCall![0] as Record<string, unknown>;
      expect(calledWith.payload).toEqual({ id: '123', value: 'test' });
      expect(calledWith.aggregateId).toBe('agg-1');
    });

    it('does not dispatch to listeners for other event names', async () => {
      const handler = vi.fn();
      bus.on('other.event.v1', handler);

      const event = createTestEvent();
      await bus.publish(event);

      expect(handler).not.toHaveBeenCalled();
    });

    it('does not throw when a listener throws', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('handler error'));
      bus.on('test.event.v1', handler);

      const event = createTestEvent();
      await expect(bus.publish(event)).resolves.not.toThrow();
    });

    it('runs all listeners even if one fails', async () => {
      const failingHandler = vi.fn().mockRejectedValue(new Error('fail'));
      const successHandler = vi.fn();

      bus.on('test.event.v1', failingHandler);
      bus.on('test.event.v1', successHandler);

      const event = createTestEvent();
      await bus.publish(event);

      expect(failingHandler).toHaveBeenCalledTimes(1);
      expect(successHandler).toHaveBeenCalledTimes(1);
    });

    it('supports wildcard event patterns', async () => {
      const handler = vi.fn();
      bus.on('test.*', handler);

      const event = createTestEvent({ name: 'test.event.v1' });
      await bus.publish(event);

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('publishAll', () => {
    it('publishes multiple events in order', async () => {
      const events: string[] = [];
      bus.on('event.1', () => {
        events.push('1');
      });
      bus.on('event.2', () => {
        events.push('2');
      });

      await bus.publishAll([createTestEvent({ name: 'event.1' }), createTestEvent({ name: 'event.2' })]);

      expect(events).toEqual(['1', '2']);
    });

    it('handles an empty event array', async () => {
      await expect(bus.publishAll([])).resolves.not.toThrow();
    });
  });

  describe('on / off', () => {
    it('removes a listener with off()', async () => {
      const handler = vi.fn();
      bus.on('test.event.v1', handler);
      bus.off('test.event.v1', handler);

      const event = createTestEvent();
      await bus.publish(event);

      expect(handler).not.toHaveBeenCalled();
    });
  });
});

// ─── @HandleEvent decorator ────────────────────────────────────────────────

describe('@HandleEvent', () => {
  it('sets metadata on the decorated method', () => {
    class TestHandler {
      @HandleEvent('inventory.stock.depleted.v1')
      handle(): void {
        /* noop */
      }
    }

    const instance = new TestHandler();
    const metadata = Reflect.getMetadata(HANDLE_EVENT_KEY, instance.handle);
    expect(metadata).toBe('inventory.stock.depleted.v1');
  });

  it('allows multiple handlers for the same event', () => {
    class Handler1 {
      @HandleEvent('test.event.v1')
      handle1(): void {
        /* noop */
      }
    }

    class Handler2 {
      @HandleEvent('test.event.v1')
      handle2(): void {
        /* noop */
      }
    }

    const h1 = new Handler1();
    const h2 = new Handler2();

    expect(Reflect.getMetadata(HANDLE_EVENT_KEY, h1.handle1)).toBe('test.event.v1');
    expect(Reflect.getMetadata(HANDLE_EVENT_KEY, h2.handle2)).toBe('test.event.v1');
  });
});

// ─── InMemoryOutboxStore ───────────────────────────────────────────────────

describe('InMemoryOutboxStore', () => {
  let store: InMemoryOutboxStore;

  beforeEach(() => {
    store = new InMemoryOutboxStore();
  });

  describe('save', () => {
    it('stores an event in the outbox', async () => {
      const event = createTestEvent();
      await store.save(event);

      const pending = await store.getPending();

      const firstEntry = pending[0]!;
      expect(firstEntry.event.name).toBe('test.event.v1');
      expect(firstEntry.sentAt).toBeNull();
      expect(firstEntry.attempts).toBe(0);
    });

    it('stores multiple events', async () => {
      await store.save(createTestEvent({ name: 'event.1' }));
      await store.save(createTestEvent({ name: 'event.2' }));
      await store.save(createTestEvent({ name: 'event.3' }));

      const pending = await store.getPending();
      expect(pending).toHaveLength(3);
    });
  });

  describe('getPending', () => {
    it('returns only unsent events', async () => {
      const event = createTestEvent();
      await store.save(event);

      const pending = await store.getPending();

      const firstEntry = pending[0]!;

      expect(pending).toHaveLength(1);

      await store.markSent(firstEntry.id);

      const stillPending = await store.getPending();
      expect(stillPending).toHaveLength(0);
    });

    it('returns empty array when no events are pending', async () => {
      const pending = await store.getPending();
      expect(pending).toEqual([]);
    });
  });

  describe('markSent', () => {
    it('marks an entry as sent', async () => {
      await store.save(createTestEvent());
      const pending = await store.getPending();

      const firstEntry = pending[0]!;
      expect(firstEntry.sentAt).toBeNull();

      await store.markSent(firstEntry.id);

      const remaining = await store.getPending();
      expect(remaining).toHaveLength(0);
    });

    it('is a no-op for unknown entry IDs', async () => {
      await expect(store.markSent('non-existent')).resolves.not.toThrow();
    });
  });

  describe('recordError', () => {
    it('increments the retry count and records the error', async () => {
      await store.save(createTestEvent());
      const pending = await store.getPending();

      const firstEntry = pending[0]!;

      await store.recordError(firstEntry.id, 'Network timeout');

      const updated = (await store.getPending())[0]!;
      expect(updated.attempts).toBe(1);
      expect(updated.lastError).toBe('Network timeout');
    });

    it('accumulates multiple errors', async () => {
      await store.save(createTestEvent());
      const pending = await store.getPending();

      const firstEntry = pending[0]!;

      await store.recordError(firstEntry.id, 'Error 1');
      await store.recordError(firstEntry.id, 'Error 2');

      const updated = (await store.getPending())[0]!;
      expect(updated.attempts).toBe(2);
      expect(updated.lastError).toBe('Error 2');
    });

    it('is a no-op for unknown entry IDs', async () => {
      await expect(store.recordError('non-existent', 'error')).resolves.not.toThrow();
    });
  });
});
