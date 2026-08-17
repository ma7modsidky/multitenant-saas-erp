import { Inject, Injectable } from '@nestjs/common';

import {
  ENTITLED_STATES_FULL,
  ENTITLED_STATES_READONLY,
  type EntitlementEntry,
  type EntitlementState,
  type IEntitlementStore,
} from './entitlement-store.interface.js';

/**
 * The set of entitlement states that grant module access.
 *
 * Current rules:
 *   - active, trialing, past_due: full access
 *   - expired: entitled but read-only (7-day grace period, BILL-3)
 *
 * @see BILL-3 — Trial expiry grace period
 * @see BILL-6 — Payment failure dunning window
 */
export const ACCESSIBLE_STATES: EntitlementState[] = [...ENTITLED_STATES_FULL, ...ENTITLED_STATES_READONLY];

/**
 * EntitlementService — runtime authority for module access (BILL-4).
 *
 * Checks whether an organization is entitled to a specific business module.
 * The service reads from core_module_entitlements (via IEntitlementStore)
 * and enforces the entitlement state machine.
 *
 * Key behaviours:
 *   - isEntitled()      — true if state is active/trialing/past_due/expired
 *   - hasFullAccess()   — true if state is active/trialing/past_due
 *   - isModuleEnabled() — true if state allows ANY access (including expired)
 *
 * This service has NO knowledge of Stripe. It reads the local entitlement
 * store, which is synced by the billing platform module (Phase 3).
 *
 * @see BILL-4 — core_module_entitlements is the runtime authority
 * @see AUTHZ-6 — Entitlement is checked before permission
 */
@Injectable()
export class EntitlementService {
  constructor(
    @Inject('ENTITLEMENT_STORE')
    private readonly store: IEntitlementStore,
  ) {}

  /**
   * Check if an organization is entitled to a module.
   *
   * "Entitled" means the organization has ANY level of access, including
   * read-only access during the expired/grace period (BILL-3).
   *
   * Returns false if:
   *   - No entitlement record exists (module never enabled)
   *   - State is 'available' (not yet enabled)
   *   - State is 'suspended' or 'disabled' (access removed)
   *
   * @param organizationId - The organization's UUID
   * @param moduleKey - The module key (e.g. 'inventory', 'pos')
   * @returns True if the organization is entitled to the module
   */
  async isEntitled(organizationId: string, moduleKey: string): Promise<boolean> {
    const entitlement = await this.store.findByOrgAndModule(organizationId, moduleKey);

    if (!entitlement) {
      return false;
    }

    return ACCESSIBLE_STATES.includes(entitlement.state);
  }

  /**
   * Check if an organization has full (read-write) access to a module.
   *
   * Full access is granted for: active, trialing, past_due.
   * Read-only (expired) does NOT count as full access.
   *
   * @param organizationId - The organization's UUID
   * @param moduleKey - The module key
   * @returns True if the organization has full access
   */
  async hasFullAccess(organizationId: string, moduleKey: string): Promise<boolean> {
    const entitlement = await this.store.findByOrgAndModule(organizationId, moduleKey);

    if (!entitlement) {
      return false;
    }

    return ENTITLED_STATES_FULL.includes(entitlement.state);
  }

  /**
   * Get the full entitlement record for an organization and module.
   *
   * @param organizationId - The organization's UUID
   * @param moduleKey - The module key
   * @returns The entitlement entry, or undefined if none exists
   */
  async getEntitlement(organizationId: string, moduleKey: string): Promise<EntitlementEntry | undefined> {
    return this.store.findByOrgAndModule(organizationId, moduleKey);
  }

  /**
   * Get all entitlements for an organization.
   *
   * @param organizationId - The organization's UUID
   * @returns Array of entitlement entries
   */
  async getOrganizationEntitlements(organizationId: string): Promise<EntitlementEntry[]> {
    return this.store.findByOrg(organizationId);
  }

  /**
   * Check if an organization has a module in a specific state.
   *
   * @param organizationId - The organization's UUID
   * @param moduleKey - The module key
   * @param state - The state to check for
   * @returns True if the entitlement exists in the given state
   */
  async hasState(organizationId: string, moduleKey: string, state: EntitlementState): Promise<boolean> {
    const entitlement = await this.store.findByOrgAndModule(organizationId, moduleKey);

    return entitlement?.state === state;
  }

  /**
   * Check whether a plan-gated feature is enabled for an organization's
   * module entitlement (PLAN §7.0.1, ACC-16, OPS-8).
   *
   * The entitlement row's `features` set is the runtime authority (BILL-4):
   * a feature not in the set behaves as ABSENT — regardless of what the
   * client thinks it can do. Fails closed: no entitlement record, or an
   * entitlement whose set was never computed, returns false.
   *
   * @param organizationId - The organization's UUID
   * @param moduleKey - The module key (e.g. 'accounting')
   * @param featureKey - Short feature key (e.g. 'advanced_coa')
   * @returns True if the feature is in the entitlement's enabled set
   */
  async isFeatureEnabled(organizationId: string, moduleKey: string, featureKey: string): Promise<boolean> {
    const entitlement = await this.store.findByOrgAndModule(organizationId, moduleKey);
    return entitlement?.features.includes(featureKey) ?? false;
  }
}
