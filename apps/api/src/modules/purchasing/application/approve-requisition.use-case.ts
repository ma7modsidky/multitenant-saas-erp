import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { EntitlementService } from '../../../core/entitlements/entitlement.service.js';
import { PURCHASING_ERROR_CODE, PurchasingDomainError, Requisition, REQUISITION_STATUS } from '../domain/index.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

/**
 * ApproveRequisitionUseCase — PUR-12: advances a `submitted` requisition
 * through the approval chain. Server-enforced: the approval path is only legal
 * when `purchasing.purchase_approval` is enabled — without it requisitions
 * approve inline at submit and never reach here.
 */
@Injectable()
export class ApproveRequisitionUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
    private readonly entitlements: EntitlementService,
  ) {}

  async execute(input: { requisitionId: string }): Promise<{ requisitionId: string; status: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();

    const purchaseApprovalEnabled = await this.entitlements.isFeatureEnabled(
      organizationId,
      'purchasing',
      'purchase_approval',
    );
    if (!purchaseApprovalEnabled) {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.APPROVAL_FEATURE_DISABLED,
        'The approval chain requires the purchase_approval feature (PUR-12).',
      );
    }

    const committed = await this.txManager.run(async (tx) => {
      const row = await this.repo.findRequisitionById(input.requisitionId, tx);
      if (!row) {
        throw new NotFoundError('PURCHASING_REQUISITION_NOT_FOUND', { requisitionId: input.requisitionId });
      }
      const requisition = Requisition.fromJSON(row);
      if (requisition.toJSON().status !== REQUISITION_STATUS.SUBMITTED) {
        throw new PurchasingDomainError(
          PURCHASING_ERROR_CODE.APPROVAL_REQUIRED,
          `Requisition ${requisition.toJSON().number} is not awaiting approval (PUR-12).`,
          { number: requisition.toJSON().number },
        );
      }
      requisition.approve(now);
      await this.repo.updateRequisitionStatus(input.requisitionId, requisition.toJSON().status, tx);
      return { requisitionId: input.requisitionId, status: requisition.toJSON().status };
    });

    return committed;
  }
}
