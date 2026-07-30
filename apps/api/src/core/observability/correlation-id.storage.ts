import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * CorrelationIdStorage — AsyncLocalStorage-based per-request correlation ID.
 *
 * Every incoming HTTP request is assigned a correlation ID that flows through
 * all async operations during request processing. This enables tracing logs
 * across services and correlating error reports.
 *
 * The correlation ID is:
 *   - Forwarded from the client via `x-correlation-id` header (if present)
 *   - Otherwise generated as a nanoid-style short ID
 *   - Attached to every log line automatically by LoggerService
 *   - Included in error responses so clients can reference it in support tickets
 *
 * @see CODING_STANDARDS.md §8 — Every log line carries correlationId
 * @see ARCHITECTURE.md §5 — Request lifecycle (step: Correlation + Logger)
 */
export class CorrelationIdStorage {
  private static readonly storage = new AsyncLocalStorage<string>();

  /**
   * Run a function with a specific correlation ID.
   * All async operations within the callback will have access to this ID.
   */
  static run<T>(correlationId: string, fn: () => Promise<T>): Promise<T> {
    return this.storage.run(correlationId, fn);
  }

  /**
   * Get the current correlation ID.
   * Returns undefined if no correlation ID is set (e.g., outside a request).
   */
  static get(): string | undefined {
    return this.storage.getStore();
  }

  /**
   * Require the current correlation ID.
   * Throws a clear error if not available.
   */
  static require(): string {
    const id = this.storage.getStore();
    if (!id) {
      throw new Error(
        'No correlation ID available. ' +
          'This operation requires an active request context. ' +
          'Ensure the request has passed through the correlation middleware.',
      );
    }
    return id;
  }

  /**
   * Generate a short, unique correlation ID.
   * Uses timestamp + random hex for compactness (avoids nanoid dependency).
   *
   * Format: 8 hex chars + 8 random chars = 16 chars, URL-safe.
   * Example: `a1b2c3d4e5f67890`
   */
  static generate(): string {
    const timestamp = Date.now().toString(36).slice(-8);
    const random = Math.random().toString(36).slice(2, 10);
    return `${timestamp}${random}`;
  }
}
