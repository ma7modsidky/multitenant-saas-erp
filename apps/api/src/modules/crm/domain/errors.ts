import { DomainError } from '../../../core/common/errors.js';

/**
 * Stable, machine-readable error codes for the crm module.
 *
 * Every code maps to a BUSINESS_RULES.md §9 rule id and is surfaced by the API
 * as an error code (CODING_STANDARDS.md §7 — API returns codes, not sentences).
 */
export const CRM_ERROR_CODE = {
  /** CRM-1 — a contact requires at least one of email or phone. */
  CONTACT_REQUIRES_IDENTITY: 'CRM_CONTACT_REQUIRES_IDENTITY',
  /** CRM-2 — contact email is unique per organization among non-deleted contacts. */
  CONTACT_DUPLICATE_EMAIL: 'CRM_CONTACT_DUPLICATE_EMAIL',
  /** CRM-3 — the default pipeline cannot be deleted. */
  PIPELINE_DEFAULT_DELETE: 'CRM_PIPELINE_DEFAULT_DELETE',
  /** CRM-4 — a pipeline needs ≥1 stage, exactly one is_won and one is_lost. */
  PIPELINE_INVALID_STAGES: 'CRM_PIPELINE_INVALID_STAGES',
  /** CRM-5 — stage positions are contiguous and unique within a pipeline. */
  PIPELINE_POSITIONS_NOT_CONTIGUOUS: 'CRM_PIPELINE_POSITIONS_NOT_CONTIGUOUS',
  /** CRM-10 — a deal must reference a contact or a company. */
  DEAL_REQUIRES_REFERENCE: 'CRM_DEAL_REQUIRES_REFERENCE',
  /** CRM-7 — moving to a lost stage requires a lost_reason_code. */
  LOST_REASON_REQUIRED: 'CRM_LOST_REASON_REQUIRED',
  /** CRM-9 — reopening a closed deal requires the crm:deal:write permission. */
  DEAL_REOPEN_PERMISSION: 'CRM_DEAL_REOPEN_PERMISSION',
  /** CRM-9 — only a closed deal can be reopened. */
  DEAL_NOT_CLOSED: 'CRM_DEAL_NOT_CLOSED',
  /** CRM-9 — a closed deal must have closed_at set. */
  DEAL_CLOSED_AT_REQUIRED: 'CRM_DEAL_CLOSED_AT_REQUIRED',
  /** CUR-5/CRM-8 — an FX rate is required to store a value in a non-base currency. */
  DEAL_FX_RATE_REQUIRED: 'CRM_DEAL_FX_RATE_REQUIRED',
  /** DATA_MODEL §5 — monetary values are never negative. */
  DEAL_VALUE_NEGATIVE: 'CRM_DEAL_VALUE_NEGATIVE',
  /** CRM-9 — a closed deal must be reopened before moving stages again. */
  DEAL_CLOSED_CANNOT_MOVE: 'CRM_DEAL_CLOSED_CANNOT_MOVE',
  /** CRM-13 — a completed activity cannot be edited (except appending notes). */
  ACTIVITY_COMPLETED_IMMUTABLE: 'CRM_ACTIVITY_COMPLETED_IMMUTABLE',
  /** crm_activities.related — related_type and related_id are a pair (DB CHECK). */
  ACTIVITY_RELATED_PAIR: 'CRM_ACTIVITY_RELATED_PAIR',
  /** CRM-14 — activity assignment is limited to active members of the org. */
  ACTIVITY_ASSIGNEE_NOT_ACTIVE: 'CRM_ACTIVITY_ASSIGNEE_NOT_ACTIVE_MEMBER',
} as const;

export type CrmErrorCode = (typeof CRM_ERROR_CODE)[keyof typeof CRM_ERROR_CODE];

/**
 * CrmError — a CRM business-rule violation (422).
 *
 * Extends the shared DomainError so the global exception filter maps it to the
 * standard error response (ERR-1).
 */
export class CrmError extends DomainError {
  constructor(code: CrmErrorCode, message: string, params?: Record<string, unknown>) {
    super(code, message, { ...params, code });
    this.name = 'CrmError';
  }
}
