import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { type FastifyReply } from 'fastify';
import type { ServerResponse } from 'node:http';

import { CorrelationIdStorage } from '../observability/correlation-id.storage.js';

import { AppError } from './errors.js';

/**
 * Error response body sent to the client.
 */
export interface ErrorResponse {
  error: {
    /** Stable, machine-readable error code */
    code: string;
    /** Optional parameters for client-side message interpolation */
    params?: Record<string, unknown>;
    /** Correlation ID for support tracing */
    correlationId: string;
    /** Optional validation error details */
    details?: Array<{
      path: string;
      code: string;
      message?: string;
    }>;
  };
}

/**
 * Internal type for the normalized exception shape returned by normalizeException.
 * Used to avoid self-referential ReturnType<this['normalizeException']> patterns.
 */
interface NormalizedException {
  httpStatus: number;
  code: string;
  params?: Record<string, unknown>;
  details?: Array<{ path: string; code: string; message?: string }>;
}

/**
 * AppExceptionFilter — global exception filter (ERR-1, ERR-5, ERR-6).
 *
 * Catches ALL unhandled exceptions thrown during request processing
 * and maps them to the standard error response format.
 *
 * Mapping rules:
 *   - AppError subclasses → use their .httpStatus and .code
 *   - NestJS HttpException → extract status and convert to error format
 *   - Unexpected errors → 500 INTERNAL_ERROR
 *
 * Every response includes the correlationId for support tracing.
 * Internal details (stack traces, SQL, driver messages) are NEVER
 * leaked to the client (ERR-5).
 *
 * @see CODING_STANDARDS.md §7 — Error model
 * @see ERR-1 — API returns codes, not sentences
 * @see ERR-6 — Unexpected errors become 500 INTERNAL_ERROR
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const correlationId = CorrelationIdStorage.get() ?? 'unknown';

    // Determine HTTP status and error code
    const { httpStatus, code, params, details } = this.normalizeException(exception);

    // Build the error response body
    const body: ErrorResponse = {
      error: {
        code,
        correlationId,
        ...(params && Object.keys(params).length > 0 ? { params } : {}),
        ...(details && details.length > 0 ? { details } : {}),
      },
    };

    // Nest's FastifyAdapter serves routes through @fastify/middie, so the
    // response passed to filters may be the raw Node ServerResponse rather
    // than a FastifyReply. Handle both shapes.
    if (typeof response.status === 'function') {
      void response.status(httpStatus).send(body);
    } else {
      const raw = response as unknown as ServerResponse;
      raw.statusCode = httpStatus;
      raw.setHeader('Content-Type', 'application/json');
      raw.end(JSON.stringify(body));
    }
  }

  /**
   * Normalize any thrown value into a standard { httpStatus, code, params }.
   */
  private normalizeException(exception: unknown): NormalizedException {
    // Our typed AppError hierarchy
    if (exception instanceof AppError) {
      return this.appErrorToNormalized(exception);
    }

    // NestJS HTTP exceptions
    if (exception instanceof HttpException) {
      return this.httpExceptionToNormalized(exception);
    }

    // Unexpected errors — never leak details (ERR-5, ERR-6)
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return {
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
    };
  }

  /**
   * Convert an AppError to the normalized format.
   */
  private appErrorToNormalized(error: AppError): NormalizedException {
    const result: NormalizedException = {
      httpStatus: error.httpStatus,
      code: error.code,
    };

    // Only add params if defined (exactOptionalPropertyTypes compliance)
    if (error.params !== undefined) {
      result.params = error.params;
    }

    return result;
  }

  /**
   * Convert a NestJS HttpException to the normalized format.
   */
  private httpExceptionToNormalized(exception: HttpException): NormalizedException {
    const response = exception.getResponse();
    const status = exception.getStatus();

    // String response: our guards pass error codes as strings
    if (typeof response === 'string') {
      return {
        httpStatus: status,
        code: this.httpStatusToCode(status, response),
        params: { message: response },
      };
    }

    // Object response: extract message and error fields
    if (typeof response === 'object' && response !== null) {
      const respObj = response as Record<string, unknown>;
      const message = respObj['message'];
      const error = respObj['error'] as string | undefined;

      const result: NormalizedException = {
        httpStatus: status,
        code: this.httpStatusToCode(status, error),
      };

      if (typeof message === 'string') {
        result.params = { message };
      }

      if (Array.isArray(message)) {
        result.details = message.map((m: string) => ({
          path: '',
          code: 'VALIDATION_ERROR',
          message: m,
        }));
      }

      return result;
    }

    // Fallback
    return {
      httpStatus: status,
      code: this.httpStatusToCode(status),
    };
  }

  /**
   * Map HTTP status to a stable error code.
   */
  private httpStatusToCode(status: number, fallback?: string): string {
    if (fallback) return fallback;

    const statusCodeMap: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
    };

    return statusCodeMap[status] ?? 'UNKNOWN_ERROR';
  }
}
