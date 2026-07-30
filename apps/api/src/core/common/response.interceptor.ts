import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * Standard successful API response envelope.
 */
export interface SuccessResponse<T = unknown> {
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * Format a value into the standard `{ data, meta }` envelope.
 *
 * Pure function — no rxjs dependencies, easily testable.
 *
 * Behaviour:
 *   - If the value already has a `data` property, pass through unchanged
 *     (assumes it's already in standard format)
 *   - Otherwise wrap as `{ data: value }`
 *   - `undefined` and `null` become `{ data: null }`
 *
 * @param data - The value to format
 * @returns The formatted response
 */
export function formatResponse<T>(data: T): SuccessResponse<T | null> {
  // Already in standard format — pass through
  if (
    data !== null &&
    data !== undefined &&
    typeof data === 'object' &&
    'data' in (data as Record<string, unknown>)
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return data as unknown as SuccessResponse<T | null>;
  }

  // Wrap plain value in { data }, converting undefined to null
  return { data: (data ?? null) as T | null } as SuccessResponse<T | null>;
}

/**
 * ResponseInterceptor — wraps all successful responses in the standard
 * `{ data, meta }` envelope.
 *
 * This interceptor does NOT handle errors — the global exception filter
 * (AppExceptionFilter) handles the error path with the `{ error }` format.
 *
 * @see CODING_STANDARDS.md §7 — Wire format
 * @see AppExceptionFilter — error response envelope
 */
@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, SuccessResponse<T | null>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessResponse<T | null>> {
    return next.handle().pipe(map(formatResponse));
  }
}
