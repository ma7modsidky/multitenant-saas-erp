import * as crypto from 'node:crypto';

import { defaultFeaturesForModule } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import {
  ENTITLEMENT_NOT_FOUND,
  MODULE_DEPENDENCY_CONFLICT,
  MODULE_DEPENDENCY_MISSING,
  MODULE_NOT_FOUND,
  TRIAL_ALREADY_USED,
  validateStateTransition,
} from '../../billing/domain/index.js';
import { BILLING_REPOSITORY, STRIPE_PORT, type BillingRepository, type StripePort } from '../../billing/ports/index.js';
import { PLATFORM_AUDIT_REPOSITORY, type PlatformAuditRepository } from '../ports/index.js';

/** States that grant any level of access (full or read-only) — BILL-8. */
const ENTITLED_STATES = ['active', 'trialing', 'past_due', 'expired'];

/**
 * SetOrganizationModuleUseCase — platform-admin entitlement override for one
 * organization (PRD §5.5 "Subscription management"). Mirrors the tenant
 * self-service state machine (EnableModuleTrialUseCase / DisableModuleUseCase)
 * but binds the TARGET organization explicitly via `runWithOrg` (PLT-3), so
 * the admin console changes WHO acts — never WHAT the BILL-* rules are
 * (PLT-5). Every mutation is appended to core_platform_audit_log (PLT-4).
 */
@Injectable()
export class SetOrganizationModuleUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly billingRepo: BillingRepository,
    @Inject(STRIPE_PORT)
    private readonly stripe: StripePort,
    @Inject(PLATFORM_AUDIT_REPOSITORY)
    private readonly auditRepo: PlatformAuditRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: {
    targetOrgId: string;
    moduleKey: string;
    action: 'enable' | 'disable';
    skipTrial?: boolean;
    /** Admin-specified trial length in days; defaults to the catalog value (PLT-8). */
    trialDays?: number;
    /** Optional end date (ISO) of a FREE full-access grant; omitted/null = unlimited (PLT-8). */
    accessUntil?: string;
    actorUserId: string | null;
    actorEmail: string | null;
  }): Promise<{ message: string }> {
    const moduleCatalog = await this.billingRepo.getModuleFromCatalog(input.moduleKey);
    if (!moduleCatalog) {
      throw new NotFoundError(MODULE_NOT_FOUND, { moduleKey: input.moduleKey });
    }

    if (input.action === 'disable') {
      await this.disable(input);
    } else {
      await this.enable(input);
    }

    return {
      message:
        input.action === 'disable'
          ? `Module '${input.moduleKey}' disabled for organization ${input.targetOrgId}.`
          : `Module '${input.moduleKey}' enabled for organization ${input.targetOrgId}.`,
    };
  }

  private async enable(input: {
    targetOrgId: string;
    moduleKey: string;
    skipTrial?: boolean;
    trialDays?: number;
    accessUntil?: string;
    actorUserId: string | null;
    actorEmail: string | null;
  }): Promise<void> {
    const moduleCatalog = (await this.billingRepo.getModuleFromCatalog(input.moduleKey))!;

    const [subscription, entitlement] = await this.txManager.runWithOrg(input.targetOrgId, async (tx) => {
      const [sub, ent] = await Promise.all([
        this.billingRepo.findByOrgId(input.targetOrgId, tx),
        this.billingRepo.findEntitlement(input.targetOrgId, input.moduleKey, tx),
      ]);
      return [sub, ent] as const;
    });

    if (entitlement && (entitlement.state === 'trialing' || entitlement.state === 'active')) {
      throw new ConflictError(
        TRIAL_ALREADY_USED,
        `Module '${input.moduleKey}' already has an active trial or subscription`,
      );
    }

    // BILL-2 (PLT-5): trials are one per organization — `trialStartedAt` is a
    // permanent stamp, so a lapsed/stopped/disabled trial can never be
    // restarted even by an admin. Admin overrides are dedicated actions
    // (extend-trial / stop-trial / enable-now), never a fresh trial.
    if (!input.skipTrial && moduleCatalog.trialDays > 0 && entitlement?.trialStartedAt) {
      throw new ConflictError(
        TRIAL_ALREADY_USED,
        `Module '${input.moduleKey}' trial has already been used by this organization`,
      );
    }

    // BILL-8: all dependencies must be entitled before enabling.
    for (const dep of moduleCatalog.dependsOn) {
      const depEntitlement = await this.txManager.runWithOrg(input.targetOrgId, (tx) =>
        this.billingRepo.findEntitlement(input.targetOrgId, dep, tx),
      );
      const depState = depEntitlement?.state ?? 'available';
      if (!ENTITLED_STATES.includes(depState)) {
        throw new ConflictError(
          MODULE_DEPENDENCY_MISSING,
          `Cannot enable '${input.moduleKey}': dependency '${dep}' is not entitled (state: ${depState})`,
        );
      }
    }

    const isTrial = !input.skipTrial && moduleCatalog.trialDays > 0;
    const targetState = isTrial ? 'trialing' : 'active';
    // PLT-8: the admin may override the catalog trial length when granting a
    // trial (1–365 days, validated by the API DTO). Defaults to the catalog.
    const trialDays = input.trialDays ?? moduleCatalog.trialDays;
    // A full-access grant is FREE — it never creates a Stripe item and the org
    // is never billed (BILL-14). Trial grants attach the module item to the
    // (lazily created) base subscription, like the tenant self-service path.
    const isFreeGrant = !isTrial;
    // PLT-8: the admin may bound a free grant with an explicit end date
    // (accessUntil); omitted = unlimited. Paid modules never use this column.
    const accessUntil = isFreeGrant && input.accessUntil ? new Date(input.accessUntil) : null;

    // PLAN §7.0.1: compute the plan-gated feature set at enable time, mirroring
    // the tenant self-service path (the entitlement row is the authority).
    const features = defaultFeaturesForModule(input.moduleKey);

    const after = await this.txManager.runWithOrg(input.targetOrgId, async (tx) => {
      let activeSubscription = subscription;
      if (isTrial) {
        // BILL-1/BILL-2: lazily create the base subscription when the org has
        // none yet (same behaviour as the tenant self-service path).
        if (!activeSubscription) {
          const billingCurrency = (await this.billingRepo.getOrganizationBaseCurrency(input.targetOrgId, tx)) ?? 'USD';
          const { customerId } = await this.stripe.createCustomer(
            input.targetOrgId,
            'Organization',
            `${input.targetOrgId}@local.dev`,
          );
          const created = await this.stripe.createSubscription({
            customerId,
            billingCurrency,
            priceKeys: [],
          });
          activeSubscription = await this.billingRepo.insert(
            {
              id: crypto.randomUUID(),
              organizationId: input.targetOrgId,
              stripeCustomerId: customerId,
              stripeSubscriptionId: created.subscriptionId,
              status: 'active',
              billingCurrency,
              currentPeriodEnd: created.currentPeriodEnd,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            tx,
          );
        }
      }

      // A free grant takes over any leftover paid item so billing stops — the
      // grant is complimentary, the org must not keep paying for it.
      if (isFreeGrant && entitlement?.stripeSubscriptionItemId) {
        await this.stripe.removeSubscriptionItem(entitlement.stripeSubscriptionItemId);
      }

      await this.billingRepo.upsertEntitlement(
        {
          organizationId: input.targetOrgId,
          moduleKey: input.moduleKey,
          state: targetState,
          // BILL-2: `trialStartedAt` is a permanent stamp. A full-access grant
          // (skipTrial) must NEVER wipe it — otherwise the org could restart
          // its trial after an admin grant. Only a fresh trial sets it.
          trialStartedAt: isTrial ? new Date() : (entitlement?.trialStartedAt ?? null),
          trialEndsAt: isTrial ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null,
          activatedAt: new Date(),
          stripeSubscriptionItemId: null,
          accessUntil,
          features,
        },
        tx,
      );

      if (isTrial && moduleCatalog.stripePriceKey) {
        const { subscriptionItemId } = await this.stripe.addSubscriptionItem({
          subscriptionId: activeSubscription!.stripeSubscriptionId,
          priceKey: moduleCatalog.stripePriceKey,
        });
        await this.billingRepo.upsertEntitlement(
          {
            organizationId: input.targetOrgId,
            moduleKey: input.moduleKey,
            state: targetState,
            stripeSubscriptionItemId: subscriptionItemId,
          },
          tx,
        );
      }

      return {
        state: targetState,
        trialEndsAt: isTrial ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null,
        accessUntil,
      };
    });

    await this.auditRepo.insert({
      action: `module.${targetState}`,
      entityType: 'organization',
      entityId: input.targetOrgId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      metadata: { moduleKey: input.moduleKey, state: targetState },
      after: {
        moduleKey: input.moduleKey,
        state: targetState,
        trialEndsAt: after.trialEndsAt?.toISOString() ?? null,
        accessUntil: after.accessUntil?.toISOString() ?? null,
      },
    });
  }

  private async disable(input: {
    targetOrgId: string;
    moduleKey: string;
    actorUserId: string | null;
    actorEmail: string | null;
  }): Promise<void> {
    const entitlement = await this.txManager.runWithOrg(input.targetOrgId, (tx) =>
      this.billingRepo.findEntitlement(input.targetOrgId, input.moduleKey, tx),
    );
    if (!entitlement) {
      throw new NotFoundError(ENTITLEMENT_NOT_FOUND, { moduleKey: input.moduleKey });
    }

    // Validate the state transition to 'disabled'.
    validateStateTransition(entitlement.state, 'disabled');

    // BILL-9: a module another entitled module depends on cannot be disabled.
    const dependentModules = await this.billingRepo.getDependentModules(input.moduleKey);
    for (const dep of dependentModules) {
      const depEntitlement = await this.txManager.runWithOrg(input.targetOrgId, (tx) =>
        this.billingRepo.findEntitlement(input.targetOrgId, dep, tx),
      );
      if (depEntitlement && ['trialing', 'active', 'past_due'].includes(depEntitlement.state)) {
        throw new ConflictError(
          MODULE_DEPENDENCY_CONFLICT,
          `Cannot disable '${input.moduleKey}': '${dep}' depends on it`,
        );
      }
    }

    await this.txManager.runWithOrg(input.targetOrgId, async (tx) => {
      if (entitlement.stripeSubscriptionItemId) {
        await this.stripe.removeSubscriptionItem(entitlement.stripeSubscriptionItemId);
      }

      await this.billingRepo.upsertEntitlement(
        {
          organizationId: input.targetOrgId,
          moduleKey: input.moduleKey,
          state: 'disabled',
          disabledAt: new Date(),
          // BILL-7: purge after the 30-day retention window.
          purgeAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          stripeSubscriptionItemId: null,
        },
        tx,
      );
    });

    await this.auditRepo.insert({
      action: 'module.disabled',
      entityType: 'organization',
      entityId: input.targetOrgId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      metadata: { moduleKey: input.moduleKey, state: 'disabled' },
      after: { moduleKey: input.moduleKey, state: 'disabled' },
    });
  }
}
