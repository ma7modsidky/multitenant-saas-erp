import { CRM_EVENTS, type CrmDealStageChangedV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { ForbiddenError, NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Deal } from '../domain/index.js';

import { DEAL_REPOSITORY, PIPELINE_REPOSITORY, type DealRepository, type PipelineRepository } from './ports/index.js';

export interface ReopenDealInput {
  dealId: string;
}

/**
 * ReopenDealUseCase — reopens a closed (won/lost) deal. Owns its transaction.
 *
 * Business rules:
 * - CRM-9: reopening requires the `crm:deal:write` permission; the deal moves
 *   back to the pipeline's first open stage (lowest position that is neither
 *   won nor lost) and `status` returns to 'open'. `closed_at` and
 *   `lost_reason_code` are preserved as historical record — never cleared.
 * - CRM-6: the reopen appends a stage-history row, so the close/reopen cycle
 *   is fully traceable.
 *
 * Collects `crm.deal.stage_changed.v1`; caller publishes events AFTER commit.
 */
@Injectable()
export class ReopenDealUseCase {
  constructor(
    @Inject(DEAL_REPOSITORY)
    private readonly dealRepo: DealRepository,
    @Inject(PIPELINE_REPOSITORY)
    private readonly pipelineRepo: PipelineRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: ReopenDealInput): Promise<{ deal: Deal }> {
    const movedBy = TenantContext.requireUserId();
    const hasDealWritePermission = TenantContext.getPermissions().includes('crm:deal:write');

    const committed = await this.txManager.run(async (tx) => {
      const existing = await this.dealRepo.findById(input.dealId, tx);
      if (!existing) {
        throw new NotFoundError('DEAL_NOT_FOUND', { dealId: input.dealId });
      }
      const deal = Deal.fromPersistence(existing);

      // CRM-9: reopening a deal requires the write permission.
      if (!hasDealWritePermission) {
        throw new ForbiddenError(
          'CRM_DEAL_REOPEN_PERMISSION',
          'Reopening a closed deal requires the crm:deal:write permission.',
        );
      }

      // Resolve the first open stage (neither won nor lost), by position.
      const pipeline = await this.pipelineRepo.findById(existing.pipelineId, tx);
      if (!pipeline) {
        throw new NotFoundError('PIPELINE_NOT_FOUND', { pipelineId: existing.pipelineId });
      }
      const openStages = pipeline.stages.filter((s) => !s.isWon && !s.isLost).sort((a, b) => a.position - b.position);
      const toStage = openStages[0];
      if (!toStage) {
        throw new NotFoundError('PIPELINE_NO_OPEN_STAGE');
      }

      const at = new Date();
      const entry = deal.reopen({
        toStageId: toStage.id,
        movedBy,
        at,
        hasDealWritePermission,
      });

      const updated = await this.dealRepo.update(input.dealId, deal.toJSON(), tx);
      if (!updated) {
        throw new NotFoundError('DEAL_NOT_FOUND', { dealId: input.dealId });
      }
      await this.dealRepo.appendHistory(entry, tx);

      const occurredAt = at.toISOString();
      const event = {
        name: CRM_EVENTS.DEAL_STAGE_CHANGED_V1,
        payload: {
          organizationId: updated.organizationId,
          dealId: updated.id,
          fromStageId: entry.fromStageId,
          toStageId: entry.toStageId,
          movedBy,
          occurredAt,
        } satisfies CrmDealStageChangedV1,
        aggregateId: updated.id,
      } satisfies Parameters<UnitOfWork['addEvent']>[0];

      return { result: { deal: Deal.fromPersistence(updated) }, event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return committed.result;
  }
}
