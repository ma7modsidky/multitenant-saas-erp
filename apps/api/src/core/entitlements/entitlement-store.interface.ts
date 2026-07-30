/**
 * Entitlement states for module access.
 *
 * Mirrors the states in core_module_entitlements (DATA_MODEL.md §4.3):
 *
 *   available  — Module is registered but not yet enabled/trialled
 *   trialing   — Module is in its free trial period (full access)
 *   active     — Module is paid and active (full access)
 *   past_due   — Payment is overdue, still full access during dunning (BILL-6)
 *   expired    — Trial expired, read-only access during grace period (BILL-3)
 *   suspended  — Payment failure exceeded dunning window, access removed
 *   disabled   — Module was manually disabled by the org admin
 *
 * @see DATA_MODEL.md §4.3 — Entitlement states
 * @see BUSINESS_RULES.md §4 — Subscription, trial, and entitlement rules
 */
export type EntitlementState =
  | 'available'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'expired'
  | 'suspended'
  | 'disabled';

/**
 * A module entitlement entry for an organization.
 */
export interface EntitlementEntry {
  /** Module key (e.g. 'crm', 'inventory', 'pos') */
  moduleKey: string;
  /** Organization ID */
  organizationId: string;
  /** Current entitlement state */
  state: EntitlementState;
  /** When the trial started (null if not trialed) */
  trialStartedAt: string | null;
  /** When the trial ends/will end (null if not trialed) */
  trialEndsAt: string | null;
  /** When the module was activated (paid or trial) */
  activatedAt: string | null;
  /** When the module was disabled (null if not disabled) */
  disabledAt: string | null;
  /** When the module data can be purged (null if not scheduled) */
  purgeAfter: string | null;
}

/**
 * States that grant full module access.
 * The organization can read and write data in the module.
 */
export const ENTITLED_STATES_FULL: EntitlementState[] = ['active', 'trialing', 'past_due'];

/**
 * States that grant limited (read-only) module access.
 * The organization can read but not write data in the module.
 */
export const ENTITLED_STATES_READONLY: EntitlementState[] = ['expired'];

/**
 * States that deny all module access.
 */
export const DENIED_STATES: EntitlementState[] = ['available', 'suspended', 'disabled'];

/**
 * All entitlement states combined.
 */
export const ALL_ENTITLEMENT_STATES: EntitlementState[] = [
  ...ENTITLED_STATES_FULL,
  ...ENTITLED_STATES_READONLY,
  ...DENIED_STATES,
];

/**
 * EntitlementStore — persistence interface for module entitlements.
 *
 * Implementations:
 *   - InMemoryEntitlementStore  (Phase 1.6 — in-memory stub)
 *   - DrizzleEntitlementStore   (Phase 2+ — backed by core_module_entitlements)
 *
 * @see BILL-4 — core_module_entitlements is the runtime authority
 */
export interface IEntitlementStore {
  /**
   * Find an entitlement by organization and module key.
   * Returns undefined if no entitlement record exists.
   */
  findByOrgAndModule(
    organizationId: string,
    moduleKey: string,
  ): Promise<EntitlementEntry | undefined>;

  /**
   * Find all entitlements for an organization.
   */
  findByOrg(organizationId: string): Promise<EntitlementEntry[]>;

  /**
   * Upsert an entitlement record.
   * Creates if not exists, updates if exists.
   */
  upsert(entry: EntitlementEntry): Promise<void>;

  /**
   * Update the state of an entitlement.
   */
  updateState(
    organizationId: string,
    moduleKey: string,
    state: EntitlementState,
  ): Promise<void>;
}
