import { Inject, Injectable } from '@nestjs/common';

import { type Event, type IEventBus } from '../events/event-bus.interface.js';

/**
 * A domain event that occurred during a transaction.
 * Collected by UnitOfWork and published after the transaction commits.
 */
export interface DomainEvent {
  /** Event name, e.g. 'inventory.stock.depleted.v1' */
  name: string;
  /** Event payload (must be JSON-serializable) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
  /** Aggregate root ID that produced this event */
  aggregateId: string;
  /** ISO 8601 timestamp when the event occurred */
  occurredAt: string;
}

/**
 * UnitOfWork — collects domain events during a transaction
 * and publishes them after the transaction commits.
 *
 * Use cases register events via `addEvent()` during the transaction.
 * After TransactionManager commits, the UnitOfWork publishes all
 * collected events through the EventBus.
 *
 * This implements the "publish after commit" guarantee:
 * handlers never observe uncommitted state.
 *
 * @see ARCHITECTURE.md §5 — Request lifecycle (step 12)
 * @see ARCHITECTURE.md §6 — Cross-module events
 */
@Injectable()
export class UnitOfWork {
  private events: DomainEvent[] = [];

  constructor(
    @Inject('EVENT_BUS')
    private readonly eventBus: IEventBus,
  ) {}

  /**
   * Register a domain event to be published after the current transaction commits.
   *
   * @param event - The domain event to publish after commit
   */
  addEvent(event: Omit<DomainEvent, 'occurredAt'>): void {
    this.events.push({
      ...event,
      occurredAt: new Date().toISOString(),
    });
  }

  /**
   * Publish all collected events.
   * Called by TransactionManager after a successful transaction commit.
   *
   * Events are dispatched through the EventBus to registered handlers.
   * The outbox store is NOT used in Phase 1.5 — events are published
   * in-process. For at-least-once delivery, integrate OutboxStore in Phase 2+.
   */
  async publishEvents(): Promise<void> {
    const events = this.flush();

    if (events.length === 0) {
      return;
    }

    // Convert DomainEvent[] to Event[] for the EventBus
    const busEvents: Event[] = events.map((e) => ({
      name: e.name,
      payload: e.payload,
      aggregateId: e.aggregateId,
      occurredAt: e.occurredAt,
    }));

    await this.eventBus.publishAll(busEvents);
  }

  /**
   * Get all currently collected events without clearing.
   */
  getEvents(): DomainEvent[] {
    return [...this.events];
  }

  /**
   * Clear all collected events and return them.
   */
  flush(): DomainEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}
