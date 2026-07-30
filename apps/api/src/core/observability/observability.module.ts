import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import { CorrelationIdMiddleware } from './correlation-id.middleware.js';
import { CorrelationIdStorage } from './correlation-id.storage.js';
import { LoggerService } from './observability.logger.js';

/**
 * ObservabilityModule — global module providing structured logging,
 * correlation IDs, and OpenTelemetry tracing infrastructure.
 *
 * Provides:
 *   - LoggerService          (injectable, use everywhere instead of console.log)
 *   - CorrelationIdStorage   (injectable AsyncLocalStorage for per-request IDs)
 *
 * Registers (via onModuleInit):
 *   - CorrelationIdMiddleware as the first middleware in the chain
 *
 * @see CODING_STANDARDS.md §8 — Logging rules
 * @see ARCHITECTURE.md §3 — core/observability
 */
@Module({
  providers: [LoggerService, CorrelationIdStorage],
  exports: [LoggerService, CorrelationIdStorage],
})
export class ObservabilityModule implements NestModule {
  /**
   * Configure the correlation ID middleware as the FIRST middleware.
   * This ensures every request has a correlation ID before any other
   * middleware, guard, or interceptor runs.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
