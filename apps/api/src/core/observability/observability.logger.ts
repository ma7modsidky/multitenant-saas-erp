import { Injectable, type LoggerService as NestLoggerService } from '@nestjs/common';
import { ConfigService } from '@modubiz/config';
import pino from 'pino';

import { CorrelationIdStorage } from './correlation-id.storage.js';
import { TenantContext } from '../tenancy/tenant-context.js';

/**
 * Standard structured log fields that every log line carries.
 */
export interface LogContext {
  /** Correlation ID for request tracing */
  correlationId?: string;
  /** Active organization ID */
  organizationId?: string;
  /** Authenticated user ID */
  userId?: string;
  /** Source module/component name */
  module?: string;
  /** Additional context fields */
  [key: string]: unknown;
}

/**
 * LoggerService — application-wide structured logger wrapping Pino.
 *
 * Every log line automatically carries:
 *   - correlationId (from CorrelationIdStorage)
 *   - organizationId (from TenantContext)
 *   - userId (from TenantContext)
 *
 * Usage:
 *   ```typescript
 *   constructor(private readonly logger: LoggerService) {}
 *
 *   this.logger.info({ saleId }, 'Sale completed');
 *   this.logger.error({ err, orderId }, 'Order processing failed');
 *   ```
 *
 * NEVER use console.log — it bypasses structured logging and correlation IDs.
 *
 * @see CODING_STANDARDS.md §8 — Logging rules
 * @see TECH_STACK.md — Pino structured logging
 */
@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: pino.Logger;

  constructor(config: ConfigService) {
    const isDev = config.isDev;
    const level = config.logLevel;

    this.logger = pino({
      level,
      // Pretty-print in dev, JSON in production
      ...(isDev
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss.l',
                ignore: 'pid,hostname',
              },
            },
          }
        : {
            formatters: {
              level(label: string) {
                return { level: label };
              },
            },
          }),
      // Serializers for standard objects
      serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
      },
      // Base fields that don't change
      base: {
        env: config.nodeEnv,
        service: 'modubiz-api',
      },
    });
  }

  /**
   * Build the enriched log context from current async storage.
   */
  private buildContext(context?: LogContext): Record<string, unknown> {
    const correlationId = CorrelationIdStorage.get();
    const currentContext = TenantContext.getCurrent();

    return {
      ...context,
      correlationId: correlationId ?? context?.correlationId,
      organizationId: currentContext?.organizationId ?? context?.organizationId,
      userId: currentContext?.userId ?? context?.userId,
    };
  }

  // ─── NestJS LoggerService interface ──────────────────────────────────────

  log(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.info(this.buildContext(ctx), message);
  }

  error(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.error(this.buildContext(ctx), message);
  }

  warn(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.warn(this.buildContext(ctx), message);
  }

  debug(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.debug(this.buildContext(ctx), message);
  }

  verbose(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.logger.trace(this.buildContext(ctx), message);
  }

  // ─── Structured logging methods ──────────────────────────────────────────

  /**
   * Log at info level with structured fields.
   *
   * @example
   * ```typescript
   * this.logger.info({ saleId: 'abc', amount: 5000 }, 'Sale completed');
   * ```
   */
  info(obj: Record<string, unknown>, msg?: string): void {
    this.logger.info(this.buildContext(obj), msg ?? '');
  }

  /**
   * Log at warn level with structured fields.
   */
  warnStructured(obj: Record<string, unknown>, msg?: string): void {
    this.logger.warn(this.buildContext(obj), msg ?? '');
  }

  /**
   * Log at error level with structured fields.
   * Automatically extracts `err` or `error` field for Pino error serialization.
   */
  errorStructured(obj: Record<string, unknown>, msg?: string): void {
    this.logger.error(this.buildContext(obj), msg ?? '');
  }

  /**
   * Log at debug level with structured fields.
   */
  debugStructured(obj: Record<string, unknown>, msg?: string): void {
    this.logger.debug(this.buildContext(obj), msg ?? '');
  }

  /**
   * Log a fatal error that requires immediate attention.
   */
  fatal(obj: Record<string, unknown>, msg?: string): void {
    this.logger.fatal(this.buildContext(obj), msg ?? '');
  }

  /**
   * Get the raw Pino logger instance.
   * Use sparingly — prefer structured methods above.
   */
  getPinoLogger(): pino.Logger {
    return this.logger;
  }

  /**
   * Extract context from NestJS-style Logger optional parameters.
   * NestJS's Logger interface passes context (usually the class name)
   * as the last parameter. We treat it as the `module` field.
   */
  private extractContext(optionalParams: unknown[]): LogContext {
    let context: LogContext = {};

    // If first param is an object, treat it as structured context
    if (optionalParams.length > 0 && typeof optionalParams[0] === 'object' && optionalParams[0] !== null) {
      context = { ...optionalParams[0] as LogContext };
      optionalParams = optionalParams.slice(1);
    }

    // Last parameter is often the NestJS context (class name)
    if (optionalParams.length > 0) {
      const lastParam = optionalParams[optionalParams.length - 1];
      if (typeof lastParam === 'string') {
        context.module = lastParam;
      }
    }

    return context;
  }
}
