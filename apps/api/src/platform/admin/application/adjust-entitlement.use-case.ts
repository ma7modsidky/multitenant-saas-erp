import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import {
  ENTITLEMENT_NOT_ACTIVE,
  ENTITLEMENT_NOT_FOUND,
  ENTITLEMENT_NOT_TRIALING,
  validateStateTransition,
} from '../../billing/domain/index.js';
import { BILLING_REPOSITORY, type BillingRepository } from '../../billing/ports/index.js';
import { PLATFORM_AUDIT_REPOSITORY, type PlatformAuditRepository } from '../ports/index.js';

export type EntitlementAdjustment =
  { action: 'extendTrial'; days: number } | { action: 'stopTrial' } | { action: 'suspend' } | { action: 'activate' };

/**
 * AdjustEntitlementUseCase — platform-admin control over one organization's
 * module entitlement lifecycle (PRD §5.5, PLT-8):
 *
 * - `extendTrial`  — push `trial_ends_at` forward by N days for a trialing
 *                    (or expired) entitlement, restoring `trialing`. Used to
 *                    grant extra trial days or revive a lapsed trial.
 * - `stopTrial`    — end a running trial now: `trialing → expired` (BILL-3
 *                    read-only grace period; the trial stamp stays, so the org
 *                    cannot restart it — BILL-2).
 * - `suspend`      — revoke a PAID module immediately: `active → suspended`.
 *                    The subscription item is kept; `activate` restores access.
 * - `activate`     — restore full access from `suspended`/`past_due`/`expired`
 *                    via the shared state machine (`→ active`).
 *
 * Every mutation binds the TARGET org via `runWithOrg` (PLT-3) and appends to
 * core_platform_audit_log with the acting admin (PLT-4, BILL-13).
 */
@Injectable()
export class AdjustEntitlementUseCase {
  constructor(
    @Inject(BILLING_REPOSITORY)
    private readonly billingRepo: BillingRepository,
    @Inject(PLATFORM_AUDIT_REPOSITORY)
    private readonly auditRepo: PlatformAuditRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(
    input: {
      targetOrgId: string;
      moduleKey: string;
      actorUserId: string | null;
      actorEmail: string | null;
    } & EntitlementAdjustment,
  ): Promise<{ message: string }> {
    switch (input.action) {
      case 'extendTrial':
        await this.extendTrial(input);
        break;
      case 'stopTrial':
        await this.stopTrial(input);
        break;
      case 'suspend':
        await this.suspend(input);
        break;
      case 'activate':
        await this.activate(input);
        break;
    }

    return { message: `Module '${input.moduleKey}' ${input.action} for organization ${input.targetOrgId}.` };
  }

  private async findEntitlement(input: { targetOrgId: string; moduleKey: string }): Promise<{
    state: string;
    trialStartedAt: Date | null;
    trialEndsAt: Date | null;
  }> {
    const entitlement = await this.txManager.runWithOrg(input.targetOrgId, (tx) =>
      this.billingRepo.findEntitlement(input.targetOrgId, input.moduleKey, tx),
    );
    if (!entitlement) {
      throw new NotFoundError(ENTITLEMENT_NOT_FOUND, { moduleKey: input.moduleKey });
    }
    return entitlement;
  }

  private async extendTrial(input: {
    targetOrgId: string;
    moduleKey: string;
    days: number;
    actorUserId: string | null;
    actorEmail: string | null;
  }): Promise<void> {
    const entitlement = await this.findEntitlement(input);
    if (entitlement.state !== 'trialing' && entitlement.state !== 'expired') {
      throw new ConflictError(
        ENTITLEMENT_NOT_TRIALING,
        `Cannot extend trial for '${input.moduleKey}': entitlement is '${entitlement.state}', expected trialing or expired`,
      );
    }

    // Extend means ADD days: the new end is computed from the later of the
    // current end date (still running) or now (lapsed/expired trial), so a
    // short extension never shortens a running trial.
    const base =
      entitlement.trialEndsAt && entitlement.trialEndsAt.getTime() > Date.now() ? entitlement.trialEndsAt : new Date();
    const trialEndsAt = new Date(base.getTime() + input.days * 24 * 60 * 60 * 1000);
    await this.txManager.runWithOrg(input.targetOrgId, (tx) =>
      this.billingRepo.upsertEntitlement(
        {
          organizationId: input.targetOrgId,
          moduleKey: input.moduleKey,
          state: 'trialing',
          trialEndsAt,
        },
        tx,
      ),
    );

    await this.auditRepo.insert({
      action: 'module.trial.extended',
      entityType: 'organization',
      entityId: input.targetOrgId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      metadata: { moduleKey: input.moduleKey, days: input.days },
      before: {
        state: entitlement.state,
        trialEndsAt: entitlement.trialEndsAt?.toISOString() ?? null,
      },
      after: { state: 'trialing', trialEndsAt: trialEndsAt.toISOString() },
    });
  }

  private async stopTrial(input: {
    targetOrgId: string;
    moduleKey: string;
    actorUserId: string | null;
    actorEmail: string | null;
  }): Promise<void> {
    const entitlement = await this.findEntitlement(input);
    if (entitlement.state !== 'trialing') {
      throw new ConflictError(
        ENTITLEMENT_NOT_TRIALING,
        `Cannot stop trial for '${input.moduleKey}': entitlement is '${entitlement.state}', expected trialing`,
      );
    }
    // BILL-3: a stopped trial moves to `expired` (read-only grace, data kept).
    validateStateTransition('trialing', 'expired');

    await this.txManager.runWithOrg(input.targetOrgId, (tx) =>
      this.billingRepo.upsertEntitlement(
        {
          organizationId: input.targetOrgId,
          moduleKey: input.moduleKey,
          state: 'expired',
        },
        tx,
      ),
    );

    await this.auditRepo.insert({
      action: 'module.trial.stopped',
      entityType: 'organization',
      entityId: input.targetOrgId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      metadata: { moduleKey: input.moduleKey },
      before: { state: 'trialing' },
      after: { state: 'expired' },
    });
  }

  private async suspend(input: {
    targetOrgId: string;
    moduleKey: string;
    actorUserId: string | null;
    actorEmail: string | null;
  }): Promise<void> {
    const entitlement = await this.findEntitlement(input);
    if (entitlement.state !== 'active') {
      throw new ConflictError(
        ENTITLEMENT_NOT_ACTIVE,
        `Cannot suspend '${input.moduleKey}': entitlement is '${entitlement.state}', expected active`,
      );
    }
    // Admin-initiated suspension of a paid module (BILL-6 vocabulary).
    validateStateTransition('active', 'suspended');

    await this.txManager.runWithOrg(input.targetOrgId, (tx) =>
      this.billingRepo.upsertEntitlement(
        {
          organizationId: input.targetOrgId,
          moduleKey: input.moduleKey,
          state: 'suspended',
        },
        tx,
      ),
    );

    await this.auditRepo.insert({
      action: 'module.suspended',
      entityType: 'organization',
      entityId: input.targetOrgId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      metadata: { moduleKey: input.moduleKey },
      before: { state: 'active' },
      after: { state: 'suspended' },
    });
  }

  private async activate(input: {
    targetOrgId: string;
    moduleKey: string;
    actorUserId: string | null;
    actorEmail: string | null;
  }): Promise<void> {
    const entitlement = await this.findEntitlement(input);
    // The shared state machine decides which states may return to `active`
    // (suspended, past_due, expired); anything else throws INVALID_STATE_TRANSITION.
    validateStateTransition(entitlement.state, 'active');

    await this.txManager.runWithOrg(input.targetOrgId, (tx) =>
      this.billingRepo.upsertEntitlement(
        {
          organizationId: input.targetOrgId,
          moduleKey: input.moduleKey,
          state: 'active',
          activatedAt: new Date(),
        },
        tx,
      ),
    );

    await this.auditRepo.insert({
      action: 'module.activated',
      entityType: 'organization',
      entityId: input.targetOrgId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      metadata: { moduleKey: input.moduleKey },
      before: { state: entitlement.state },
      after: { state: 'active' },
    });
  }
}
