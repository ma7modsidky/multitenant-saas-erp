export interface AuditLogEntryResponse {
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
}

export interface AuditLogQueryResponse {
  entries: AuditLogEntryResponse[];
  total: number;
  page: number;
  pageSize: number;
}
