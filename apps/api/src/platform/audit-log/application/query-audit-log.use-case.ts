import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_LOG_REPOSITORY, type AuditLogRepository } from '../ports/index.js';

@Injectable()
export class QueryAuditLogUseCase {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly repo: AuditLogRepository,
  ) {}

  async execute(input: {
    organizationId: string;
    actorUserId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
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
      occurredAt: string;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = input.page ?? 1;
    const pageSize = Math.min(input.pageSize ?? 50, 200);
    const offset = (page - 1) * pageSize;

    // Build filter object conditionally for exactOptionalPropertyTypes
    const filter: Record<string, unknown> = { organizationId: input.organizationId };
    if (input.actorUserId !== undefined) filter.actorUserId = input.actorUserId;
    if (input.entityType !== undefined) filter.entityType = input.entityType;
    if (input.entityId !== undefined) filter.entityId = input.entityId;
    if (input.action !== undefined) filter.action = input.action;
    if (input.fromDate !== undefined) filter.fromDate = input.fromDate;
    if (input.toDate !== undefined) filter.toDate = input.toDate;
    filter.limit = pageSize;
    filter.offset = offset;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic filter for exactOptionalPropertyTypes
    const result = await this.repo.query(filter as any);

    return {
      entries: result.entries.map((e) => ({
        ...e,
        occurredAt: e.occurredAt instanceof Date ? e.occurredAt.toISOString() : String(e.occurredAt),
      })),
      total: result.total,
      page,
      pageSize,
    };
  }
}
