import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Deal } from '../domain/index.js';

import { MoveDealStageUseCase } from './move-deal-stage.use-case.js';
import { DEAL_REPOSITORY, PIPELINE_REPOSITORY, type DealRepository, type PipelineRepository } from './ports/index.js';

export interface CloseDealInput {
  dealId: string;
  /** 'won' or 'lost'. */
  outcome: 'won' | 'lost';
  /** Required when outcome is 'lost' (CRM-7). */
  lostReasonCode?: string | null;
}

/**
 * CloseDealUseCase — closes a deal as won or lost. Owns its transaction.
 *
 * Resolves the pipeline's won/lost stage, then delegates the actual move to
 * MoveDealStageUseCase — so CRM-6 (history row), CRM-9 (closed_at + status)
 * and the won/lost events all behave identically to a manual stage move.
 *
 * Business rules:
 * - CRM-7: closing as lost requires a `lost_reason_code`.
 * - CRM-9: closing sets `status` + `closed_at`; a closed deal cannot be
 *   closed again — reopen it first.
 */
@Injectable()
export class CloseDealUseCase {
  constructor(
    @Inject(DEAL_REPOSITORY)
    private readonly dealRepo: DealRepository,
    @Inject(PIPELINE_REPOSITORY)
    private readonly pipelineRepo: PipelineRepository,
    private readonly moveStage: MoveDealStageUseCase,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: CloseDealInput): Promise<{ deal: Deal }> {
    // NOTE: the resolve below runs in its OWN read-only transaction (not the
    // move's) because repository reads outside a transaction have no RLS
    // binding (fail-closed) — a bare `this.pipelineRepo.findById()` would
    // return zero rows. The move itself (MoveDealStageUseCase) re-loads the
    // deal inside ITS transaction, so CRM-9 state checks apply to current
    // data — do not "optimize" this into one transaction or drop the tx.
    const result = await this.txManager.run(async (tx) => {
      const existing = await this.dealRepo.findById(input.dealId, tx);
      if (!existing) {
        throw new NotFoundError('DEAL_NOT_FOUND', { dealId: input.dealId });
      }

      const pipeline = await this.pipelineRepo.findById(existing.pipelineId, tx);
      if (!pipeline) {
        throw new NotFoundError('PIPELINE_NOT_FOUND', { pipelineId: existing.pipelineId });
      }

      const targetStage = pipeline.stages.find((s) => (input.outcome === 'won' ? s.isWon : s.isLost));
      if (!targetStage) {
        throw new NotFoundError('PIPELINE_STAGE_NOT_FOUND', { outcome: input.outcome });
      }

      return { deal: existing, toStageId: targetStage.id };
    });

    // The move itself happens in MoveDealStageUseCase's own transaction.
    const { deal } = await this.moveStage.execute({
      dealId: input.dealId,
      toStageId: result.toStageId,
      ...(input.lostReasonCode !== undefined ? { lostReasonCode: input.lostReasonCode } : {}),
    });
    return { deal };
  }
}
