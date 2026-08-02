import { Global, Module } from '@nestjs/common';

import { PortRegistry } from './port-registry.js';

/**
 * PortsModule — cross-module port registration infrastructure (PLAN §3.4).
 *
 * Provides `PortRegistry`, the single place where port tokens declared in
 * module descriptors (`providesPorts`) are mapped to their implementations.
 * Consumers resolve port tokens through the registry instead of importing the
 * providing module's source.
 *
 * Marked `@Global` so any module (core, platform, business) can inject the
 * registry without an explicit import chain.
 *
 * @see PLAN.md §3.4 — Port registration infrastructure
 * @see ARCHITECTURE.md §6 — Level 2/3 ports
 */
@Global()
@Module({
  providers: [PortRegistry],
  exports: [PortRegistry],
})
export class PortsModule {}
