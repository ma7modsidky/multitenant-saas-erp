import { Injectable, SetMetadata } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

/**
 * Metadata key for event handler declarations.
 * Used by the EventBus to discover registered listeners.
 */
export const HANDLE_EVENT_KEY = 'events:handleEvent';

/**
 * @HandleEvent() decorator.
 *
 * Declares a method as an event handler for a specific domain event.
 * The method will be invoked when the named event is published through
 * the EventBus.
 *
 * Event handlers MUST be:
 *   - Idempotent (OPS-2): processing the same event twice has no side effects
 *   - Safe to retry: a failure does not corrupt state
 *   - Non-blocking: must not throw back into the publisher (OPS-3)
 *
 * Handlers can be async and typically delegate to a use case or service.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class OnStockDepleted {
 *   @HandleEvent('inventory.stock.depleted.v1')
 *   async handle(event: Event) {
 *     // Delegate to a use case
 *     await this.restockService.createReplenishmentOrder(event.payload);
 *   }
 * }
 * ```
 *
 * @see ARCHITECTURE.md §6.1 — Level 1: Asynchronous events
 * @see OPS-2 — Handlers are idempotent
 * @see OPS-3 — Handlers must not throw back into the publisher
 */
export const HandleEvent = (eventName: string): MethodDecorator => {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor => {
    // Store metadata for programmatic discovery
    SetMetadata(HANDLE_EVENT_KEY, eventName)(target, propertyKey, descriptor);

    // Register with @nestjs/event-emitter for runtime dispatch
    OnEvent(eventName, { async: true })(target, propertyKey, descriptor);

    return descriptor;
  };
};
