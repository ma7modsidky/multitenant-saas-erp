import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { TransactionManager } from '../database/transaction-manager.js';
import { TenantContext, type TenantContextData } from '../tenancy/tenant-context.js';
import { type AuditEntry } from './audit-logger.js';

/**
 * AuditDbWriter — persists audit entries to `core_audit_log` (AUD-1, AUD-2).
 *
 * Phase 2 persistence for the append-only audit trail. The AuditInterceptor
 * (global) records every @Audit()-decorated mutation both to the in-memory
 * AuditLogger (back-compat + tests) and, best-effort, to the DB via this
 * writer — the DB write must NEVER fail the originating request (NOTIF-1
 * pattern), so all failures are swallowed and logged.
 *
 * RLS: core_audit_log is org-scoped. The write runs inside a fresh
 * transaction whose context is re-derived from the request user captured at
 * intercept time — the interceptor's tap fires AFTER the handler's own
 * transaction committed, and interceptor ordering means the ambient
 * TenantContext may no longer be bound, so we rebuild it explicitly instead
 * of relying on AsyncLocalStorage.
 *
 * @see BUSINESS_RULES.md — AUD-1 (mutations write audit entries), AUD-2 (append-only)
 */
@Injectable()
export class AuditDbWriter {
  constructor(private readonly txManager: TransactionManager) {}

  /**
   * Persist an already-redacted audit entry to core_audit_log.
   * Best-effort: any failure (RLS, malformed uuid actor, db outage) is logged
   * and swallowed — audit must never take down the originating request.
   */
  async write(entry: AuditEntry, tenant: TenantContextData): Promise<void> {
    // core_audit_log.organization_id is NOT NULL — system-context routes
    // (login, signup, refresh) have no org; there is nowhere safe to store
    // them, so skip. Platform mutations always carry an org.
    if (!tenant.organizationId) return;

    // actor_user_id is a uuid column; the in-memory entry uses 'system' as a
    // sentinel for non-user actors — map it to NULL with actor_type='system'.
    const actorUserId = entry.actorId === 'system' ? null : entry.actorId;
    const actorType = entry.actorId === 'system' ? 'system' : 'user';

    try {
      // Rebuild the tenant context from the request snapshot and bind the org
      // explicitly (runWithOrg) so RLS WITH CHECK passes regardless of
      // interceptor ordering.
      await TenantContext.run(tenant, () =>
        this.txManager.runWithOrg(tenant.organizationId!, async (tx) => {
          await tx.execute(sql`
            INSERT INTO core_audit_log
              (organization_id, actor_user_id, actor_type, action, entity_type, entity_id,
               before, after, ip, correlation_id, occurred_at)
            VALUES
              (${tenant.organizationId}, ${actorUserId}, ${actorType}, ${entry.action}, ${entry.entityType}, ${entry.entityId},
               ${entry.before === null || entry.before === undefined ? null : JSON.stringify(entry.before)},
               ${entry.after === null || entry.after === undefined ? null : JSON.stringify(entry.after)},
               ${entry.ipAddress ?? null}, ${entry.correlationId ?? null}, ${entry.occurredAt})
          `);
        }),
      );
    } catch (err) {
      // Audit logging must never fail the originating operation (NOTIF-1).
      // eslint-disable-next-line no-console -- core logger unavailable in this hot path; matches AuditInterceptor
      console.error('Failed to persist audit entry:', err instanceof Error ? err.message : String(err));
    }
  }
}
