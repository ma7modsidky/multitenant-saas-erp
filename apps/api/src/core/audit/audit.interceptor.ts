import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Optional,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';

import { type TenantContextData } from '../tenancy/tenant-context.js';
import { AuditDbWriter } from './audit-db-writer.js';
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
    @Optional()
    @Inject(AuditDbWriter)
    private readonly dbWriter: AuditDbWriter | null = null,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.get<AuditMetadata | undefined>(AUDIT_METADATA_KEY, context.getHandler());

    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const user = request.user as { sub?: string; email?: string; organizationId?: string; locale?: string } | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const correlationId = request.headers?.['x-correlation-id'] as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const ipAddress = request.ip as string | undefined;

    const actorId = user?.sub ?? 'system';
    const actorEmail = user?.email ?? 'system';

    // Snapshot the tenant context AT INTERCEPT TIME. The interceptor's tap
    // fires after the handler (and its transaction) has committed, and global
    // interceptor ordering means the ambient TenantContext may no longer be
    // bound — so the DB writer rebuilds the context from this snapshot.
    const tenant: TenantContextData = {
      userId: user?.sub ?? 'system',
      sessionId: undefined,
      organizationId: user?.organizationId,
      roles: [],
      permissions: [],
      locale: user?.locale ?? 'en',
    };

    return next.handle().pipe(
      tap({
        next: () => {
          // Record audit entry after successful completion.
          // Use conditional spread for optional fields to satisfy exactOptionalPropertyTypes.
          this.auditLogger
            .record({
              actorId,
              actorEmail,
              action: metadata.action,
              entityType: metadata.entityType,
              entityId: (request.params?.id as string | undefined) ?? 'unknown',
              ...(correlationId !== undefined ? { correlationId } : {}),
              ...(ipAddress !== undefined ? { ipAddress } : {}),
              ...(metadata.captureAfter && request.body ? { after: request.body as Record<string, unknown> } : {}),
            })
            .then((entry) => {
              // Best-effort DB persistence (AUD-1/AUD-2): never awaits the
              // response, never rejects the request — AuditDbWriter swallows
              // failures internally.
              if (this.dbWriter) {
                return this.dbWriter.write(entry, tenant);
              }
              return undefined;
            })
            .catch((err: Error) => {
              // Audit logging must never fail the originating operation (NOTIF-1 pattern)
              console.error('Failed to record audit entry:', err.message);
            });
        },
      }),
    );
  }
}
