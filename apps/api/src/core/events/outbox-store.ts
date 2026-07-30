import { Injectable } from '@nestjs/common';

import { type Event } from './event-bus.interface.js';

/**
 * OutboxEntry — a single event persisted in the outbox for durable delivery.
 *
 * Events are written to the outbox within the same database transaction as
 * the business operation. A background job reads the outbox and publishes
 * events to the EventBus, then marks them as sent.
 */
export interface OutboxEntry {
  /** Unique identifier for the outbox entry */
  id: string;
  /** The domain event to publish */
  event: Event;
  /** ISO 8601 timestamp when the entry was created */
  createdAt: string;
  /** ISO 8601 timestamp when the entry was sent (null if pending) */
  sentAt: string | null;
  /** Number of delivery attempts */
  attempts: number;
  /** Last error message (null if no errors) */
  lastError: string | null;
}

/**
 * OutboxStore — interface for persisting events for durable delivery.
 *
 * The transactional outbox pattern ensures at-least-once delivery:
 *   1. Business operation writes to the database within a transaction
 *   2. The same transaction writes the event to the outbox table
 *   3. After commit, a background job reads pending outbox entries
 *   4. Each entry is published to the EventBus
 *   5. On success, the entry is marked as sent
 *   6. On failure, the entry is retried with backoff
 *
 * In Phase 1.5, this is an in-memory stub. Phase 2+ will replace it with
 * a PostgreSQL-backed implementation (core_outbox table).
 */
export interface IOutboxStore {
  /** Store an event in the outbox for later delivery */
  save(event: Event): Promise<void>;

  /** Get all pending (unsent) outbox entries */
  getPending(): Promise<OutboxEntry[]>;

  /** Mark an outbox entry as sent */
  markSent(entryId: string): Promise<void>;

  /** Increment the retry count and record the error */
  recordError(entryId: string, error: string): Promise<void>;
}

/**
 * InMemoryOutboxStore — in-memory implementation of IOutboxStore.
 *
 * Used for development and testing. Events are lost on process restart.
 * Phase 2+ will replace with a PostgreSQL-backed implementation.
 *
 * @see OPS-3 — Failed event handlers are retried with backoff
 */
@Injectable()
export class InMemoryOutboxStore implements IOutboxStore {
  private readonly entries: OutboxEntry[] = [];
  private nextId = 1;

  async save(event: Event): Promise<void> {
    const entry: OutboxEntry = {
      id: String(this.nextId++),
      event,
      createdAt: new Date().toISOString(),
      sentAt: null,
      attempts: 0,
      lastError: null,
    };

    this.entries.push(entry);
  }

  async getPending(): Promise<OutboxEntry[]> {
    return this.entries.filter((e) => e.sentAt === null);
  }

  async markSent(entryId: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === entryId);
    if (entry) {
      entry.sentAt = new Date().toISOString();
    }
  }

  async recordError(entryId: string, error: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === entryId);
    if (entry) {
      entry.attempts++;
      entry.lastError = error;
    }
  }
}
