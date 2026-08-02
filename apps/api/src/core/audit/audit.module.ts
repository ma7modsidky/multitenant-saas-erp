import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AuditDbWriter } from './audit-db-writer.js';
import { AuditLogger } from './audit-logger.js';
import { AuditInterceptor } from './audit.interceptor.js';

/**
 * AuditModule — append-only audit logging infrastructure.
 *
 * Provides:
 *   - AuditLogger: records mutating operations with actor, action, entity,
 *     before/after state, IP, and correlation ID
 *   - AuditDbWriter: best-effort persistence to `core_audit_log` (AUD-1/AUD-2)
 *   - AuditInterceptor (global): automatically records audit entries for
 *     handlers decorated with @Audit() — in-memory + DB persistence
 *   - Redaction: sensitive fields (passwords, tokens, etc.) are redacted
 *     before persistence (AUD-3)
 *
 * Phase 1.9 used an in-memory store; Phase 2 persists to the `core_audit_log`
 * table via AuditDbWriter (append-only, trigger-guarded). The interceptor
 * writes BOTH (in-memory for back-compat tests, DB for the audit-log API).
 *
 * @see PLAN.md §1.9 — Audit
 * @see BUSINESS_RULES.md — AUD-1, AUD-2, AUD-3
 */
@Global()
@Module({
  providers: [
    AuditLogger,
    AuditDbWriter,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [AuditLogger],
})
export class AuditModule {}
