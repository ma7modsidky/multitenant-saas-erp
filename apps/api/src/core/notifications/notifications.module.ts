import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';

/**
 * NotificationsModule — async notification dispatch infrastructure.
 *
 * Provides:
 *   - NotificationsService: best-effort in-app + email dispatch (NOTIF-1)
 *     with idempotency per (type, entity, recipient) (NOTIF-3)
 *
 * Phase 1.11 uses in-memory storage. Phase 2+ will integrate with
 * real providers (Resend/SendGrid for email, Pusher/WebSockets for in-app).
 *
 * @see PLAN.md §1.11 — Notifications
 * @see BUSINESS_RULES.md — NOTIF-1, NOTIF-3
 */
@Global()
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
