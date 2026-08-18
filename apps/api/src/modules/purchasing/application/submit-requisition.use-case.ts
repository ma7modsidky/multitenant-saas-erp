import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { EntitlementService } from '../../../core/entitlements/entitlement.service.js';
import { Requisition, type RequisitionLineInput } from '../domain/index.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

export interface SubmitRequisitionInput {
  lines: RequisitionLineInput[];
  requiredByDate?: string | null;
  notes?: string | null;
}

/**
 * SubmitRequisitionUseCase — PUR-12: purchase approval is PLAN-GATED
 * (`purchasing.purchase_approval`). Feature OFF ⇒ the authorized user approves
 * inline (submit flips the requisition straight to `approved`). Feature ON ⇒
 * the requisition lands in `submitted` awaiting the multi-step approval chain
 * (ApproverRequisitionUseCase advances it). Enforcement is server-side from
 * the entitlement's feature set — never client state (OPS-8).
 */
@Injectable()
export class SubmitRequisitionUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
    private readonly entitlements: EntitlementService,
  ) {}

  async execute(input: SubmitRequisitionInput): Promise<{ requisitionId: string; status: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const purchaseApprovalEnabled = await this.entitlements.isFeatureEnabled(
      organizationId,
      'purchasing',
      'purchase_approval',
    );

    const committed = await this.txManager.run(async (tx) => {
      const requisition = Requisition.create({
        id: crypto.randomUUID(),
        organizationId,
        number: await this.repo.allocateRequisitionNumber(tx),
        requestedBy: userId,
        requiredByDate: input.requiredByDate ?? null,
        notes: input.notes ?? null,
        lines: input.lines,
        now,
      });

      // PUR-12: feature OFF ⇒ inline approval (no chain); ON ⇒ submitted.
      if (!purchaseApprovalEnabled) {
        requisition.approve(now);
      } else {
        requisition.submit(now);
      }

      await this.repo.insertRequisition(requisition.toJSON(), tx);
      return { requisitionId: requisition.id, status: requisition.toJSON().status };
    });

    return committed;
  }
}
