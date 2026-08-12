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

import { TransactionManager } from '../database/transaction-manager.js';
import { type TenantContextData, TenantContext } from '../tenancy/tenant-context.js';
import { AuditBeforeStateRegistry } from './audit-before-state.js';
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
  /**
   * Whether to capture the pre-mutation entity state as 'before' (AUD-1).
   * Requires a registered before-state loader for the entityType (modules
   * register table-backed loaders at bootstrap) AND a `:id` route param.
   */
  captureBefore?: boolean;
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
 * Response id keys to try per entityType when deriving the entity id for
 * CREATE routes (POST has no `:id` path param — AUD-1 requires the real id).
 * The controller response envelope is `{ data: { <field>Id: string, ... } }`.
 */
const RESPONSE_ID_KEYS: Record<string, readonly string[]> = {
  product: ['productId', 'id'],
  product_variant: ['variantId', 'id'],
  stock_movement: ['movementId', 'transferOutId', 'transferInId', 'id'],
  reservation: ['reservationId', 'id'],
  warehouse: ['id', 'warehouseId'],
  stock_count: ['id', 'stockCountId'],
  register: ['id', 'registerId'],
  shift: ['id', 'shiftId'],
  sale: ['saleId', 'id'],
  refund: ['refundId', 'id'],
  deal: ['id', 'dealId'],
  company: ['id'],
  contact: ['id', 'contactId'],
  activity: ['id'],
  invitation: ['invitationId', 'id'],
  membership: ['id', 'membershipId'],
  role: ['id', 'roleId'],
  organization: ['id'],
  organization_settings: ['id'],
  user: ['id'],
};

/**
 * Extract the created/updated entity id from the handler's response envelope
 * (`{ data: { productId, ... } }`). Tries the entityType-specific keys first,
 * then any key ending in `Id` with a string value; null when the response
 * carries no id (the caller then falls back to the `:id` param / 'unknown').
 */
export function extractEntityIdFromResponse(entityType: string, response: unknown): string | null {
  const data = (response as { data?: unknown } | null | undefined)?.data;
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  for (const key of RESPONSE_ID_KEYS[entityType] ?? ['id']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  for (const [key, value] of Object.entries(record)) {
    if (key.endsWith('Id') && typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/**
 * AuditInterceptor — global interceptor that records audit entries for
 * mutating operations decorated with @Audit().
 *
 * Captures (AUD-1): actor, action, entity type + id (derived from the response
 * for creates, the `:id` param for updates), before/after state, IP, and
 * correlation id. Sensitive fields are redacted by AuditLogger (AUD-3).
 *
 * Before-state is read BEST-EFFORT in a tenant-bound transaction BEFORE the
 * handler runs (modules register loaders via AuditBeforeStateRegistry). Any
 * failure degrades to `before: null` — audit must never fail the request.
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
    @Optional()
    @Inject(AuditBeforeStateRegistry)
    private readonly beforeStateRegistry: AuditBeforeStateRegistry | null = null,
    @Optional()
    @Inject(TransactionManager)
    private readonly txManager: TransactionManager | null = null,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
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
    // bound — so the DB writer and the before-state read rebuild the context
    // from this snapshot.
    const tenant: TenantContextData = {
      userId: user?.sub ?? 'system',
      sessionId: undefined,
      organizationId: user?.organizationId,
      roles: [],
      permissions: [],
      locale: user?.locale ?? 'en',
    };

    const paramsId = request.params?.id as string | undefined;

    // Before-state capture (AUD-1): read the pre-mutation row in a
    // tenant-bound transaction BEFORE the handler runs. Best-effort — any
    // failure (RLS, missing loader, db outage) logs and degrades to null.
    let before: Record<string, unknown> | null = null;
    const beforeState = this.beforeStateRegistry;
    const txManager = this.txManager;
    if (metadata.captureBefore && paramsId !== undefined && beforeState !== null && txManager !== null) {
      try {
        before = await TenantContext.run(tenant, () =>
          txManager.run((tx) => beforeState.load(metadata.entityType, paramsId, tx)),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Audit logging must never fail the originating operation (NOTIF-1
        // pattern). eslint-disable-next-line no-console — core logger unavailable in this hot path; matches AuditDbWriter
        console.error(`Failed to capture audit before-state for ${metadata.entityType}:${paramsId}:`, message);
      }
    }

    return next.handle().pipe(
      tap({
        next: (value) => {
          // Resolve the entity id: creates carry it in the response envelope
          // (POST has no `:id`), updates carry it in the route param.
          const entityId = extractEntityIdFromResponse(metadata.entityType, value) ?? paramsId ?? 'unknown';

          // Record audit entry after successful completion.
          // Use conditional spread for optional fields to satisfy exactOptionalPropertyTypes.
          this.auditLogger
            .record({
              actorId,
              actorEmail,
              action: metadata.action,
              entityType: metadata.entityType,
              entityId,
              ...(before !== null ? { before } : {}),
              ...(metadata.captureAfter && request.body ? { after: request.body as Record<string, unknown> } : {}),
              ...(correlationId !== undefined ? { correlationId } : {}),
              ...(ipAddress !== undefined ? { ipAddress } : {}),
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
