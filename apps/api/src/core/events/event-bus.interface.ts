/**
 * A domain event to be published through the EventBus.
 *
 * Payloads are published as-is. For events that must survive a process
 * restart, use the transactional outbox pattern (OutboxStore).
 *
 * @see ARCHITECTURE.md §6 — Cross-module events
 */
export interface Event<T = Record<string, unknown>> {
  /** Event name in format `<module>.<aggregate>.<pastTenseAction>.v<major>` */
  name: string;
  /** Event payload (must be JSON-serializable) */
  payload: T;
  /** Aggregate root ID that produced this event */
  aggregateId: string;
  /** ISO 8601 timestamp when the event occurred */
  occurredAt: string;
  /** Optional correlation ID for tracing across handlers */
  correlationId?: string;
  /** Optional organization ID for tenant-scoped events */
  organizationId?: string;
}

/**
 * Listener function signature for event handlers.
 * Must be idempotent (OPS-2) and must not throw back into the publisher.
 */
export type EventListener<T = Record<string, unknown>> = (event: Event<T>) => Promise<void> | void;

/**
 * IEventBus — abstraction over the event publishing infrastructure.
 *
 * The EventBus is the backbone of cross-module communication (Level 1).
 * Modules publish events without knowing who listens. Handlers are
 * registered declaratively via @HandleEvent().
 *
 * The default implementation uses @nestjs/event-emitter (EventEmitter2)
 * for in-process dispatch. For durable delivery, events go through the
 * transactional outbox (OutboxStore).
 *
 * @see ARCHITECTURE.md §6.1 — Level 1: Asynchronous events
 * @see TECH_STACK.md §2 — In-process events via @nestjs/event-emitter
 */
export interface IEventBus {
  /**
   * Publish a single event to all registered listeners.
   *
   * Dispatch is synchronous (in-process) by default. Listeners run
   * in the same event loop tick but are awaited sequentially.
   * The method never throws — listener errors are caught and logged.
   *
   * @param event - The domain event to publish
   */
  publish(event: Event): Promise<void>;

  /**
   * Publish multiple events atomically from an after-commit handler.
   *
   * Called by UnitOfWork.publishEvents() after a successful transaction.
   * Each event is dispatched in order. A failing listener does not
   * prevent subsequent listeners from running.
   *
   * @param events - Array of domain events to publish
   */
  publishAll(events: Event[]): Promise<void>;

  /**
   * Register a listener for a specific event name.
   *
   * Typically not called directly — use @HandleEvent() decorator instead.
   *
   * @param eventName - The event name to listen for
   * @param listener - The handler function
   */
  on(eventName: string, listener: EventListener): void;

  /**
   * Remove a specific listener for an event.
   *
   * @param eventName - The event name
   * @param listener - The handler function to remove
   */
  off(eventName: string, listener: EventListener): void;
}
