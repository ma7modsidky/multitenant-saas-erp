import type { TxOrDb } from '../../../core/database/repository.base.js';
import { type SubscriptionData } from '../domain/index.js';

export interface BillingRepository {
  // ─── Subscriptions ─────────────────────────────────────────────────----

  /** Find subscription by organization ID. */
  findByOrgId(organizationId: string, tx?: TxOrDb): Promise<SubscriptionData | undefined>;

  /** Find subscription by Stripe subscription ID. */
  findByStripeSubscriptionId(stripeSubscriptionId: string, tx?: TxOrDb): Promise<SubscriptionData | undefined>;

  /** Insert a new subscription. */
  insert(data: SubscriptionData, tx?: TxOrDb): Promise<SubscriptionData>;

  /** Update an existing subscription. */
  update(id: string, data: Partial<SubscriptionData>, tx?: TxOrDb): Promise<SubscriptionData | undefined>;

  // ─── Module Catalog ─────────────────────────────────────────────────────

  /** Get module catalog entry by key (stripe_price_key, depends_on, trial_days). */
  getModuleFromCatalog(moduleKey: string, tx?: TxOrDb): Promise<{ key: string; stripePriceKey: string | null; dependsOn: string[]; trialDays: number } | undefined>;

  /** Find module by Stripe price key. */
  findModuleByStripePriceKey(priceKey: string, tx?: TxOrDb): Promise<{ key: string } | undefined>;

  /** Get all catalog module keys that depend on the given module. */
  getDependentModules(moduleKey: string, tx?: TxOrDb): Promise<string[]>;

  // ─── Entitlements ───────────────────────────────────────────────────────

  /** Find entitlement state for an org + module. */
  findEntitlement(organizationId: string, moduleKey: string, tx?: TxOrDb): Promise<{ id: string; moduleKey: string; state: string; trialStartedAt: Date | null; trialEndsAt: Date | null; activatedAt: Date | null; disabledAt: Date | null; purgeAfter: Date | null; stripeSubscriptionItemId: string | null } | undefined>;

  /** Upsert an entitlement record. */
  upsertEntitlement(data: {
    organizationId: string;
    moduleKey: string;
    state: string;
    trialStartedAt?: Date | null;
    trialEndsAt?: Date | null;
    activatedAt?: Date | null;
    disabledAt?: Date | null;
    purgeAfter?: Date | null;
    stripeSubscriptionItemId?: string | null;
    updatedBy?: string | null;
  }, tx?: TxOrDb): Promise<void>;

  /** Update entitlement state. */
  updateEntitlementState(organizationId: string, moduleKey: string, state: string, tx?: TxOrDb): Promise<void>;

  /** Get all entitlements for an organization. */
  findEntitlementsByOrg(organizationId: string, tx?: TxOrDb): Promise<Array<{ id: string; moduleKey: string; state: string }>>;

  /** Get all active subscription items for an organization. */
  findActiveSubscriptionItems(organizationId: string, tx?: TxOrDb): Promise<Array<{ moduleKey: string; stripeSubscriptionItemId: string | null; state: string }>>;
}

export const BILLING_REPOSITORY = Symbol('BILLING_REPOSITORY');
