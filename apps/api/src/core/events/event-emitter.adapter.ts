import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { type Event, type EventListener, type IEventBus } from './event-bus.interface.js';

/**
 * EventEmitter2EventBus — in-process EventBus implementation using
 * @nestjs/event-emitter (EventEmitter2).
 *
 * This is the default Level 1 cross-module communication mechanism:
 *   - Publishers do not know who listens
 *   - Handlers run in-process within the same event loop tick
 *   - Handlers are awaited sequentially per event
 *   - A failing handler does not crash the publisher or other handlers
 *
 * For events that must survive process restarts, use the transactional
 * outbox pattern (OutboxStore) alongside this bus.
 *
 * @see ARCHITECTURE.md §6.1 — Level 1: Asynchronous events
 * @see TECH_STACK.md §2 — EventEmitter2
 */
@Injectable()
export class EventEmitter2EventBus implements IEventBus {
  private readonly logger = new Logger(EventEmitter2EventBus.name);

  /**
   * Maps original listeners to their wrapped handlers so that off() can
   * correctly remove the wrapped version from EventEmitter2.
   */
  private readonly listenerMap = new Map<
    EventListener,
    (...args: unknown[]) => Promise<void>
  >();

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Publish a single event to all registered listeners.
   *
   * Listeners are invoked in the order they were registered.
   * Errors from listeners are caught and logged — they never propagate
   * to the publisher.
   *
   * @param event - The domain event to publish
   */
  async publish(event: Event): Promise<void> {
    const { name, ...data } = event;

    this.logger.debug(`Publishing event: ${name} (aggregate: ${event.aggregateId})`);

    try {
      await this.eventEmitter.emitAsync(name, data);
    } catch (error) {
      // Listeners must never throw back to the publisher (OPS-3).
      // Catch and log any errors from handlers.
      this.logger.error(
        `Error in handler for event "${name}": ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Publish multiple events atomically from an after-commit handler.
   *
   * Each event is dispatched in order. If a listener for event N fails,
   * event N+1 still runs. All errors are logged but not rethrown.
   *
   * @param events - Array of domain events to publish
   */
  async publishAll(events: Event[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  /**
   * Register a listener for a specific event name.
   *
   * The listener is wrapped in a try/catch to ensure that errors from
   * handlers never propagate to the publisher. The wrapped handler
   * reference is stored so off() can remove it correctly.
   *
   * @param eventName - The event name to listen for
   * @param listener - The handler function
   */
  on(eventName: string, listener: EventListener): void {
    const wrappedHandler = async (...args: unknown[]): Promise<void> => {
      try {
        // The first arg is the event data from EventEmitter2
        const eventData = args[0] as Record<string, unknown>;
        await listener(eventData as unknown as Event);
      } catch (error) {
        this.logger.error(
          `Error in listener for "${eventName}": ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    };

    // Store the mapping so off() can remove the wrapped handler
    this.listenerMap.set(listener, wrappedHandler);
    this.eventEmitter.on(eventName, wrappedHandler);
  }

  /**
   * Remove a specific listener for an event.
   *
   * Looks up the wrapped handler that was registered by on() and
   * removes it from EventEmitter2.
   *
   * @param eventName - The event name
   * @param listener - The handler function to remove
   */
  off(eventName: string, listener: EventListener): void {
    const wrappedHandler = this.listenerMap.get(listener);
    if (wrappedHandler) {
      this.eventEmitter.removeListener(eventName, wrappedHandler);
      this.listenerMap.delete(listener);
    }
  }
}
