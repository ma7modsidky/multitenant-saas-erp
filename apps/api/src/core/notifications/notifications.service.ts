import { Injectable, Logger } from '@nestjs/common';

/**
 * Notification type.
 */
export type NotificationType = 'in_app' | 'email';
export type NotificationPriority = 'low' | 'normal' | 'high';

/**
 * A notification to be delivered to a user.
 */
export interface Notification {
  /** Unique notification ID */
  readonly id: string;
  /** Notification type */
  readonly type: NotificationType;
  /** Recipient user ID */
  readonly userId: string;
  /** Recipient email (for email notifications) */
  readonly email?: string;
  /** Notification title (i18n key) */
  readonly titleKey: string;
  /** Notification body (i18n key or plain text) */
  readonly bodyKey: string;
  /** Template parameters for i18n interpolation */
  readonly params?: Record<string, string>;
  /** Reference entity type (for idempotency — NOTIF-3) */
  readonly entityType?: string;
  /** Reference entity ID (for idempotency — NOTIF-3) */
  readonly entityId?: string;
  /** Priority */
  readonly priority: NotificationPriority;
  /** Organization context */
  readonly organizationId?: string;
  /** ISO 8601 timestamp */
  readonly createdAt: string;
  /** Delivery status */
  status: 'pending' | 'sent' | 'failed';
}

/**
 * NotificationsService — async notification dispatch.
 *
 * Supports in-app and email delivery. Notifications are best-effort
 * and must never fail the originating operation (NOTIF-1).
 *
 * Deduplication is based on (type, entityType, entityId, recipient)
 * to ensure idempotency (NOTIF-3).
 *
 * Phase 1.11 uses in-memory storage and no-op delivery.
 * Phase 2+ will integrate with real email providers and in-app
 * notification infrastructure.
 *
 * @see NOTIF-1 — Failed notification never fails the originating operation
 * @see NOTIF-3 — Notifications are idempotent per (type, entity, recipient)
 * @see PLAN.md §1.11 — Notifications
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly notifications: Notification[] = [];
  private readonly sentKeys = new Set<string>();
  private nextId = 1;

  /**
   * Send a notification. Best-effort — never throws (NOTIF-1).
   */
  async send(params: {
    type: NotificationType;
    userId: string;
    email?: string;
    titleKey: string;
    bodyKey: string;
    params?: Record<string, string>;
    entityType?: string;
    entityId?: string;
    priority?: NotificationPriority;
    organizationId?: string;
  }): Promise<Notification | null> {
    try {
      // Check idempotency (NOTIF-3)
      if (params.entityType && params.entityId) {
        const dedupKey = `${params.type}:${params.entityType}:${params.entityId}:${params.userId}`;
        if (this.sentKeys.has(dedupKey)) {
          this.logger.debug(`Duplicate notification suppressed: ${dedupKey}`);
          return null;
        }
        this.sentKeys.add(dedupKey);
      }

      const now = new Date().toISOString();

      // Use conditional spread for optional fields to satisfy exactOptionalPropertyTypes
      const notification: Notification = {
        id: String(this.nextId++),
        type: params.type,
        userId: params.userId,
        ...(params.email !== undefined ? { email: params.email } : {}),
        titleKey: params.titleKey,
        bodyKey: params.bodyKey,
        ...(params.params !== undefined ? { params: params.params } : {}),
        ...(params.entityType !== undefined ? { entityType: params.entityType } : {}),
        ...(params.entityId !== undefined ? { entityId: params.entityId } : {}),
        ...(params.organizationId !== undefined ? { organizationId: params.organizationId } : {}),
        priority: params.priority ?? 'normal',
        createdAt: now,
        status: 'pending',
      };

      this.notifications.push(notification);
      notification.status = 'sent';
      this.logger.debug(`Notification sent: ${params.type} to ${params.userId} (${params.titleKey})`);

      return notification;
    } catch (error) {
      // NOTIF-1: Never fail the originating operation
      this.logger.error(
        `Failed to send notification: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return null;
    }
  }

  /**
   * Get notifications for a user.
   */
  async getForUser(userId: string, limit = 50, offset = 0): Promise<{ notifications: Notification[]; total: number }> {
    const userNotifications = this.notifications
      .filter((n) => n.userId === userId)
      .sort((a, b) => {
        const dateCmp = b.createdAt.localeCompare(a.createdAt); // newest first
        if (dateCmp !== 0) return dateCmp;
        return Number(b.id) - Number(a.id); // tie-break by ID
      });

    const total = userNotifications.length;
    const paginated = userNotifications.slice(offset, offset + limit);

    return { notifications: paginated, total };
  }

  /**
   * Mark a notification as read (in-app only).
   * Phase 2+ will implement actual read tracking.
   */
  async markRead(notificationId: string): Promise<void> {
    this.logger.debug(`Notification marked as read: ${notificationId}`);
  }

  /** Get total notifications count. */
  get totalSent(): number {
    return this.notifications.length;
  }
}
