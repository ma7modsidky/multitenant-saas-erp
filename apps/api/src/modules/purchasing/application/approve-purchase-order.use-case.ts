import { PURCHASING_EVENTS } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { PurchaseOrder, PO_STATUS } from '../domain/index.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';
import { buildPoApprovedEvent } from '../events/published/index.js';

/**
 * ApprovePurchaseOrderUseCase — PUR-3: Pending Approval → Approved. The
 * transition is audited by the controller's @Audit decorator. Publishing
 * `purchasing.po.approved.v1` after commit.
 */
@Injectable()
export class ApprovePurchaseOrderUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: { purchaseOrderId: string }): Promise<{ purchaseOrderId: string; number: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      const row = await this.repo.findPurchaseOrderById(input.purchaseOrderId, tx);
      if (!row) {
        throw new NotFoundError('PURCHASING_PO_NOT_FOUND', { purchaseOrderId: input.purchaseOrderId });
      }
      const po = PurchaseOrder.fromJSON(row);
      // PUR-3: Draft → Pending Approval → Approved (an approved PO is the
      // receiving/billing authority). A draft is first submitted, then approved.
      if (po.status === PO_STATUS.DRAFT) {
        po.transitionTo(PO_STATUS.PENDING_APPROVAL, now);
        await this.repo.updatePurchaseOrderStatus(input.purchaseOrderId, po.status, tx);
      }
      po.transitionTo(PO_STATUS.APPROVED, now);
      await this.repo.updatePurchaseOrderStatus(input.purchaseOrderId, po.status, tx);

      const event = buildPoApprovedEvent(
        organizationId,
        po.id,
        po.number,
        po.supplierId,
        po.totalMinor,
        po.currency,
        now,
      );
      return { purchaseOrderId: po.id, number: po.number, event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return { purchaseOrderId: committed.purchaseOrderId, number: committed.number };
  }
}
