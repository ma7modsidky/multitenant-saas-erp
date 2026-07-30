import { Injectable, Logger } from '@nestjs/common';

/**
 * Audit action types.
 */
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'SOFT_DELETE' | 'RESTORE' | 'LOGIN' | 'LOGOUT' | 'EXPORT' | 'IMPORT' | 'OTHER';

/**
 * An audit log entry recording a mutating operation.
 *
 * @see AUD-1 — Mutating operations write audit entries with all required fields
 * @see AUD-2 — core_audit_log is append-only
 * @see AUD-3 — Sensitive fields are redacted
 */
export interface AuditEntry {
  /** Unique entry ID */
  readonly id: string;
  /** Actor who performed the operation */
  readonly actorId: string;
  /** Actor's email at time of action */
  readonly actorEmail: string;
  /** What action was performed */
  readonly action: AuditAction;
  /** The entity type (e.g., 'user', 'organization', 'role') */
  readonly entityType: string;
  /** The entity's unique identifier */
  readonly entityId: string;
  /** Optional organization context */
  readonly organizationId?: string;
  /** State before the mutation (JSON, redacted) */
  readonly before?: Record<string, unknown> | null;
  /** State after the mutation (JSON, redacted) */
  readonly after?: Record<string, unknown> | null;
  /** IP address of the requester */
  readonly ipAddress?: string;
  /** Correlation ID from the request for traceability */
  readonly correlationId?: string;
  /** ISO 8601 timestamp */
  readonly occurredAt: string;
}

// ─── Redaction ──────────────────────────────────────────────────────────────

/**
 * Fields whose values are redacted in audit logs (AUD-3).
 */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'refreshToken',
  'refresh_token',
  'secret',
  'accessToken',
  'access_token',
  'cardNumber',
  'card_number',
  'cvv',
  'pin',
  'secretKey',
  'secret_key',
  'apiKey',
  'api_key',
  'sessionToken',
  'session_token',
]);

/**
 * Maximum depth for recursive redaction.
 */
const MAX_REDACT_DEPTH = 10;

/**
 * Recursively redact sensitive fields from an object (AUD-3).
 * Replaces sensitive values with the string '[REDACTED]'.
 */
export function redactSensitiveFields(
  data: Record<string, unknown> | null | undefined,
  depth = 0,
): Record<string, unknown> | null | undefined {
  if (!data || depth >= MAX_REDACT_DEPTH) {
    return data;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (REDACTED_FIELDS.has(key)) {
      redacted[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      redacted[key] = redactSensitiveFields(value as Record<string, unknown>, depth + 1);
    } else if (Array.isArray(value)) {
      redacted[key] = value.map((item) => {
        if (item !== null && typeof item === 'object') {
          return redactSensitiveFields(item as Record<string, unknown>, depth + 1);
        }
        return item;
      });
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

// ─── AuditLogger ────────────────────────────────────────────────────────────

/**
 * AuditLogger — append-only logger for mutating operations (AUD-1, AUD-2).
 *
 * Records every create/update/delete with actor, action, entity, before/after
 * state, IP, and correlation ID. Sensitive fields are redacted before
 * persistence (AUD-3).
 *
 * Phase 1.9 uses an in-memory store. Phase 2+ will persist to the
 * `core_audit_log` table via Drizzle.
 *
 * @see PLAN.md §1.9 — Audit
 * @see BUSINESS_RULES.md — AUD-1, AUD-2, AUD-3
 */
@Injectable()
export class AuditLogger {
  private readonly logger = new Logger(AuditLogger.name);
  private readonly entries: AuditEntry[] = [];
  private nextId = 1;

  /**
   * Record a mutating operation in the audit log.
   *
   * @param params - Audit entry parameters
   */
  async record(params: {
    actorId: string;
    actorEmail: string;
    action: AuditAction;
    entityType: string;
    entityId: string;
    organizationId?: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    ipAddress?: string;
    correlationId?: string;
  }): Promise<AuditEntry> {
    // Use conditional spread for optional properties to satisfy
    // exactOptionalPropertyTypes (TEN-3 pattern — fail closed).
    const entry: AuditEntry = {
      id: String(this.nextId++),
      actorId: params.actorId,
      actorEmail: params.actorEmail,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      ...(params.organizationId !== undefined ? { organizationId: params.organizationId } : {}),
      before: redactSensitiveFields(params.before ?? null) as Record<string, unknown> | null,
      after: redactSensitiveFields(params.after ?? null) as Record<string, unknown> | null,
      ...(params.ipAddress !== undefined ? { ipAddress: params.ipAddress } : {}),
      ...(params.correlationId !== undefined ? { correlationId: params.correlationId } : {}),
      occurredAt: new Date().toISOString(),
    };

    this.entries.push(entry);
    this.logger.debug(`Audit: ${entry.action} ${entry.entityType}:${entry.entityId} by ${entry.actorId}`);

    return entry;
  }

  /**
   * Query audit entries (in-memory implementation).
   * Supports filtering by actor, entity, action, and date range.
   *
   * Phase 2+ will use SQL queries on `core_audit_log`.
   */
  async query(filters: {
    actorId?: string;
    entityType?: string;
    entityId?: string;
    action?: AuditAction;
    organizationId?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: AuditEntry[]; total: number }> {
    let filtered = [...this.entries];

    if (filters.actorId) {
      filtered = filtered.filter((e) => e.actorId === filters.actorId);
    }
    if (filters.entityType) {
      filtered = filtered.filter((e) => e.entityType === filters.entityType);
    }
    if (filters.entityId) {
      filtered = filtered.filter((e) => e.entityId === filters.entityId);
    }
    if (filters.action) {
      filtered = filtered.filter((e) => e.action === filters.action);
    }
    if (filters.organizationId) {
      filtered = filtered.filter((e) => e.organizationId === filters.organizationId);
    }
    if (filters.fromDate) {
      filtered = filtered.filter((e) => e.occurredAt >= filters.fromDate!);
    }
    if (filters.toDate) {
      filtered = filtered.filter((e) => e.occurredAt <= filters.toDate!);
    }

    // Sort by most recent first, tie-break by ID (newer = higher ID)
    filtered.sort((a, b) => {
      const dateCmp = b.occurredAt.localeCompare(a.occurredAt);
      if (dateCmp !== 0) return dateCmp;
      return Number(b.id) - Number(a.id);
    });

    const total = filtered.length;
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    const paginated = filtered.slice(offset, offset + limit);

    return { entries: paginated, total };
  }

  /** Get the total number of entries. */
  get entryCount(): number {
    return this.entries.length;
  }
}
