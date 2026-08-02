import type { TxOrDb } from '../../../core/database/repository.base.js';

/**
 * Repository for reading audit log entries.
 * The audit log is append-only — no create/update/delete operations.
 *
 * @see BUSINESS_RULES.md — AUD-1 (mutating ops write audit entries), AUD-2 (append-only)
 */
export interface AuditLogRepository {
  /** Query audit entries with filters and pagination. */
  query(
    filters: {
      organizationId: string;
      actorUserId?: string;
      entityType?: string;
      entityId?: string;
      action?: string;
      fromDate?: string;
      toDate?: string;
      limit?: number;
      offset?: number;
    },
    tx?: TxOrDb,
  ): Promise<{
    entries: Array<{
      id: string;
      actorUserId: string | null;
      actorType: string;
      action: string;
      entityType: string;
      entityId: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      ip: string | null;
      correlationId: string | null;
      occurredAt: Date;
    }>;
    total: number;
  }>;
}

export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY');
