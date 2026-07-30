import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { EventEmitter2EventBus } from './event-emitter.adapter.js';
import { type IEventBus } from './event-bus.interface.js';
import { type IOutboxStore, InMemoryOutboxStore } from './outbox-store.js';

/**
 * EventsModule — the event infrastructure module.
 *
 * Provides:
 *   - EventEmitter2Module: registers EventEmitter2 (in-process event dispatch)
 *   - EventBus (IEventBus): abstracted event publishing interface
 *   - OutboxStore (IOutboxStore): durable event persistence for at-least-once delivery
 *
 * The EventBus is the default Level 1 cross-module communication mechanism
 * (ARCHITECTURE.md §6). Modules publish events through IEventBus without
 * knowing who listens. Handlers are registered via @HandleEvent() decorator.
 *
 * The module is marked @Global so that EventBus is available everywhere
 * without explicit imports.
 *
 * EventEmitter2 config:
 *   - wildcard: true — supports event name patterns like "inventory.*"
 *   - delimiter: '.' — matches the event naming convention `<module>.<aggregate>.<action>.v<major>`
 *   - maxListeners: 20 — generous default for module handlers
 *
 * @see ARCHITECTURE.md §3 — core/events
 * @see ARCHITECTURE.md §6.1 — Level 1: Asynchronous events
 * @see TECH_STACK.md §2 — EventEmitter2
 */
@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
  ],
  providers: [
    {
      provide: 'EVENT_BUS',
      useClass: EventEmitter2EventBus,
    },
    {
      provide: 'OUTBOX_STORE',
      useClass: InMemoryOutboxStore,
    },
    EventEmitter2EventBus,
    InMemoryOutboxStore,
  ],
  exports: ['EVENT_BUS', 'OUTBOX_STORE', EventEmitter2EventBus, InMemoryOutboxStore],
})
export class EventsModule {}
