/** Organization already has a subscription. */
export const SUBSCRIPTION_ALREADY_EXISTS = 'SUBSCRIPTION_ALREADY_EXISTS';

/** No subscription found. */
export const SUBSCRIPTION_NOT_FOUND = 'SUBSCRIPTION_NOT_FOUND';

/** Module not found in catalog. */
export const MODULE_NOT_FOUND = 'MODULE_NOT_FOUND';

/** Dependency module is not entitled (BILL-8). */
export const MODULE_DEPENDENCY_MISSING = 'MODULE_DEPENDENCY_MISSING';

/** Cannot disable a module that another entitled module depends on (BILL-9). */
export const MODULE_DEPENDENCY_CONFLICT = 'MODULE_DEPENDENCY_CONFLICT';

/** Trial already used for this module (BILL-2). */
export const TRIAL_ALREADY_USED = 'TRIAL_ALREADY_USED';

/** Module is admin-blocked until the org subscribes (PLT-8). */
export const MODULE_BLOCKED = 'MODULE_BLOCKED';

/** No entitlement found for enabling/disabling. */
export const ENTITLEMENT_NOT_FOUND = 'ENTITLEMENT_NOT_FOUND';

/** Admin action (extend/stop trial) requires a trialing (or expired) entitlement. */
export const ENTITLEMENT_NOT_TRIALING = 'ENTITLEMENT_NOT_TRIALING';

/** Admin action (suspend) requires an active entitlement. */
export const ENTITLEMENT_NOT_ACTIVE = 'ENTITLEMENT_NOT_ACTIVE';

/** Invalid webhook signature. */
export const WEBHOOK_SIGNATURE_INVALID = 'WEBHOOK_SIGNATURE_INVALID';

/** Webhook event already processed (idempotent). */
export const WEBHOOK_ALREADY_PROCESSED = 'WEBHOOK_ALREADY_PROCESSED';

/** Billing currency is immutable after first subscription (BILL-11). */
export const BILLING_CURRENCY_IMMUTABLE = 'BILLING_CURRENCY_IMMUTABLE';

/** Invalid entitlement state transition. */
export const INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION';
