import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import {
  ADMIN_DIRECTORY_REPOSITORY,
  PLATFORM_AUDIT_REPOSITORY,
  type AdminDirectoryRepository,
  type PlatformAuditRepository,
} from '../ports/index.js';

/** Default feed size — the admin org-detail "Recent activity" card (PLT-4). */
export const ORG_ACTIVITY_DEFAULT_LIMIT = 20;
export const ORG_ACTIVITY_MAX_LIMIT = 100;

/**
 * GetOrganizationActivityUseCase — recent platform-admin actions against one
 * organization (PLT-4): enable/disable, trial extend/stop, block, suspend,
 * activate. Reads core_platform_audit_log (global, append-only) newest-first.
 */
@Injectable()
export class GetOrganizationActivityUseCase {
  constructor(
    @Inject(ADMIN_DIRECTORY_REPOSITORY)
    private readonly directoryRepo: AdminDirectoryRepository,
    @Inject(PLATFORM_AUDIT_REPOSITORY)
    private readonly auditRepo: PlatformAuditRepository,
  ) {}

  async execute(input: {
    organizationId: string;
    /** Clamped to [1, ORG_ACTIVITY_MAX_LIMIT]; defaults to ORG_ACTIVITY_DEFAULT_LIMIT. */
    limit?: number;
  }): Promise<{
    items: Array<{
      id: string;
      action: string;
      actorUserId: string | null;
      actorEmail: string | null;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      metadata: Record<string, unknown> | null;
      occurredAt: string;
    }>;
  }> {
    const org = await this.directoryRepo.findOrgById(input.organizationId);
    if (!org) {
      throw new NotFoundError('ORG_NOT_FOUND', { organizationId: input.organizationId });
    }

    // Non-finite limits (e.g. `?limit=abc`) fall back to the default instead
    // of breaking `LIMIT NaN` — this GET route has no Zod pipe on query params.
    const requested = input.limit;
    const limit =
      requested === undefined || !Number.isFinite(requested)
        ? ORG_ACTIVITY_DEFAULT_LIMIT
        : Math.min(Math.max(1, Math.trunc(requested)), ORG_ACTIVITY_MAX_LIMIT);

    const rows = await this.auditRepo.listByOrg(input.organizationId, limit);

    return {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        actorUserId: row.actorUserId,
        actorEmail: row.actorEmail,
        before: row.before,
        after: row.after,
        metadata: row.metadata,
        occurredAt: row.occurredAt.toISOString(),
      })),
    };
  }
}
