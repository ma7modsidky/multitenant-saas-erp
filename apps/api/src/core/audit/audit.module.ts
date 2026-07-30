import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AuditLogger } from './audit-logger.js';
import { AuditInterceptor } from './audit.interceptor.js';

/**
 * AuditModule — append-only audit logging infrastructure.
 *
 * Provides:
 *   - AuditLogger: records mutating operations with actor, action, entity,
 *     before/after state, IP, and correlation ID
 *   - AuditInterceptor (global): automatically records audit entries for
 *     handlers decorated with @Audit()
 *   - Redaction: sensitive fields (passwords, tokens, etc.) are redacted
 *     before persistence (AUD-3)
 *
 * Phase 1.9 uses an in-memory store. Phase 2+ will persist to the
 * `core_audit_log` table via Drizzle (append-only, trigger-guarded).
 *
 * @see PLAN.md §1.9 — Audit
 * @see BUSINESS_RULES.md — AUD-1, AUD-2, AUD-3
 */
@Global()
@Module({
  providers: [
    AuditLogger,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [AuditLogger],
})
export class AuditModule {}
