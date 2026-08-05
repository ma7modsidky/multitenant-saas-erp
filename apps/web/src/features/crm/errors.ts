import { ApiError } from '@/lib/api';

/** Map CRM API error codes to `modules.crm.errors.*` i18n keys. */
const CRM_ERROR_MESSAGES: Record<string, string> = {
  CRM_CONTACT_DUPLICATE_EMAIL: 'errors.duplicateEmail',
  CRM_CONTACT_REQUIRES_IDENTITY: 'errors.requiresIdentity',
  CRM_LOST_REASON_REQUIRED: 'errors.lostReasonRequired',
  CRM_DEAL_REQUIRES_REFERENCE: 'errors.dealRequiresReference',
  CRM_DEAL_FX_RATE_REQUIRED: 'errors.dealFxRateRequired',
  CRM_ACTIVITY_ASSIGNEE_NOT_ACTIVE_MEMBER: 'errors.activityAssigneeInvalid',
  CRM_ACTIVITY_COMPLETED_IMMUTABLE: 'errors.activityCompletedImmutable',
};

/** Resolve a thrown error to a `modules.crm.errors.*` i18n key. */
export function crmErrorKey(err: unknown): string {
  if (err instanceof ApiError) return CRM_ERROR_MESSAGES[err.code] ?? 'errors.unknown';
  return 'errors.unknown';
}
