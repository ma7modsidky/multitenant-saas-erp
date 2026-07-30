import { type NestMiddleware, Injectable } from '@nestjs/common';
import { type FastifyRequest, type FastifyReply } from 'fastify';

import { CorrelationIdStorage } from './correlation-id.storage.js';

/** Header name for forwarding/propagating the correlation ID */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * CorrelationIdMiddleware — assigns a correlation ID to every request.
 *
 * Behaviour:
 *   1. Reads `x-correlation-id` header from the client (if present)
 *   2. Falls back to a generated short ID
 *   3. Sets the response header so the client can correlate
 *   4. Wraps the handler in CorrelationIdStorage for downstream access
 *
 * This middleware MUST run before any logging occurs.
 * It is registered first in the middleware chain in ObservabilityModule.
 *
 * @see CODING_STANDARDS.md §8 — Logging and observability
 * @see CorrelationIdStorage — AsyncLocalStorage provider
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: FastifyRequest, res: FastifyReply, next: () => void): void {
    // Read forwarded correlation ID or generate a new one
    const forwardedId = req.headers[CORRELATION_ID_HEADER] as string | undefined;
    const correlationId = forwardedId?.trim() || CorrelationIdStorage.generate();

    // Set the response header so the client can correlate
    void res.header(CORRELATION_ID_HEADER, correlationId);

    // Run the request pipeline within the correlation ID context.
    // This ensures all async operations (guards, interceptors, handlers)
    // can access the correlation ID via CorrelationIdStorage.get().
    CorrelationIdStorage.run(correlationId, async () => {
      next();
    });
  }
}
