import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';

import { AuditLogger, type AuditAction } from './audit-logger.js';

/**
 * Metadata for declarative audit logging.
 */
export interface AuditMetadata {
  action: AuditAction;
  entityType: string;
  /** Whether to capture the request body as 'after' state */
  captureAfter?: boolean;
}

/**
 * @Audit() decorator — declarative audit logging for controllers.
 */
export const AUDIT_METADATA_KEY = 'audit:metadata';

export function Audit(metadata: AuditMetadata): MethodDecorator {
  return (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor => {
    Reflect.defineMetadata(AUDIT_METADATA_KEY, metadata, descriptor.value);
    return descriptor;
  };
}

/**
 * AuditInterceptor — global interceptor that records audit entries for
 * mutating operations decorated with @Audit().
 *
 * @see AUD-1 — Mutating operations write audit entries
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditLogger: AuditLogger,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.get<AuditMetadata | undefined>(
      AUDIT_METADATA_KEY,
      context.getHandler(),
    );

    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const user = request.user as { sub?: string; email?: string } | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const correlationId = request.headers?.['x-correlation-id'] as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const ipAddress = request.ip as string | undefined;

    const actorId = user?.sub ?? 'system';
    const actorEmail = user?.email ?? 'system';

    return next.handle().pipe(
      tap({
        next: () => {
          // Record audit entry after successful completion.
          // Use conditional spread for optional fields to satisfy exactOptionalPropertyTypes.
          this.auditLogger.record({
            actorId,
            actorEmail,
            action: metadata.action,
            entityType: metadata.entityType,
            entityId: (request.params?.id as string | undefined) ?? 'unknown',
            ...(correlationId !== undefined ? { correlationId } : {}),
            ...(ipAddress !== undefined ? { ipAddress } : {}),
            ...(metadata.captureAfter && request.body
              ? { after: request.body as Record<string, unknown> }
              : {}),
          }).catch((err: Error) => {
            // Audit logging must never fail the originating operation (NOTIF-1 pattern)
            console.error('Failed to record audit entry:', err.message);
          });
        },
      }),
    );
  }
}
