import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Audit log entry response payload.
 */
export const auditLogEntryResponseSchema = z.object({
  id: z.string(),
  actorUserId: z.string().nullable(),
  actorType: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  correlationId: z.string().nullable(),
  occurredAt: z.string(),
});

/**
 * Audit log entry response DTO.
 */
export class AuditLogEntryResponse extends createZodDto(auditLogEntryResponseSchema) {}

/**
 * Audit log query response payload.
 */
export const auditLogQueryResponseSchema = z.object({
  entries: z.array(auditLogEntryResponseSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

/**
 * Audit log query response DTO.
 */
export class AuditLogQueryResponse extends createZodDto(auditLogQueryResponseSchema) {}

// ─── Response envelope (matches the `{ data }` wire format) ───────────────

/** `{ data: AuditLogQueryResponse }` — query audit log. */
export const auditLogQueryEnvelopeSchema = z.object({
  data: auditLogQueryResponseSchema,
});

export class AuditLogQueryEnvelopeResponse extends createZodDto(auditLogQueryEnvelopeSchema) {}
