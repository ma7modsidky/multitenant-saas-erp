import { CRM_EVENTS, type CrmDealLostV1, type CrmDealStageChangedV1, type CrmDealWonV1 } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Deal } from '../domain/index.js';

import { DEAL_REPOSITORY, PIPELINE_REPOSITORY, type DealRepository, type PipelineRepository } from './ports/index.js';

export interface MoveDealStageInput {
  dealId: string;
  toStageId: string;
  /** Required when the target stage is lost (CRM-7). */
  lostReasonCode?: string | null;
}

/**
 * MoveDealStageUseCase — moves a deal to another stage. Owns its transaction.
 *
 * Business rules:
 * - CRM-6: every stage change appends a row to `crm_deal_stage_history` with
 *   the elapsed duration in the previous stage.
 * - CRM-7: moving to a lost stage requires a `lost_reason_code`.
 * - CRM-9: moving to a won/lost stage closes the deal (`closed_at` set); a
 *   closed deal cannot move — reopen it first.
 *
 * Collects `crm.deal.stage_changed.v1` (always) and `crm.deal.won.v1` /
 * `crm.deal.lost.v1` (when the target stage closes the deal); the caller
 * publishes events AFTER commit.
 */
@Injectable()
export class MoveDealStageUseCase {
  constructor(
    @Inject(DEAL_REPOSITORY)
    private readonly dealRepo: DealRepository,
    @Inject(PIPELINE_REPOSITORY)
    private readonly pipelineRepo: PipelineRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: MoveDealStageInput): Promise<{ deal: Deal }> {
    const movedBy = TenantContext.requireUserId();

    const committed = await this.txManager.run(async (tx) => {
      const existing = await this.dealRepo.findById(input.dealId, tx);
      if (!existing) {
        throw new NotFoundError('DEAL_NOT_FOUND', { dealId: input.dealId });
      }
      const deal = Deal.fromPersistence(existing);

      // Load the pipeline to resolve the target stage's won/lost flags.
      const pipeline = await this.pipelineRepo.findById(existing.pipelineId, tx);
      if (!pipeline) {
        throw new NotFoundError('PIPELINE_NOT_FOUND', { pipelineId: existing.pipelineId });
      }
      const toStage = pipeline.stages.find((s) => s.id === input.toStageId);
      if (!toStage) {
        throw new NotFoundError('PIPELINE_STAGE_NOT_FOUND', { stageId: input.toStageId });
      }

      const at = new Date();
      const entry = deal.moveToStage({
        toStageId: input.toStageId,
        toStageIsWon: toStage.isWon,
        toStageIsLost: toStage.isLost,
        movedBy,
        at,
        ...(input.lostReasonCode !== undefined ? { lostReasonCode: input.lostReasonCode } : {}),
      });

      const updated = await this.dealRepo.update(input.dealId, deal.toJSON(), tx);
      if (!updated) {
        throw new NotFoundError('DEAL_NOT_FOUND', { dealId: input.dealId });
      }
      // CRM-6: append the history row (append-only).
      await this.dealRepo.appendHistory(entry, tx);

      const occurredAt = at.toISOString();
      const events: Array<Parameters<UnitOfWork['addEvent']>[0]> = [];
      events.push({
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
      });

      if (toStage.isWon) {
        events.push({
          name: CRM_EVENTS.DEAL_WON_V1,
          payload: {
            organizationId: updated.organizationId,
            dealId: updated.id,
            valueAmountMinor: updated.valueAmountMinor.toString(),
            valueCurrency: updated.valueCurrency,
            ...(updated.exchangeRate !== null ? { exchangeRate: toPlainDecimal(updated.exchangeRate) } : {}),
            ...(updated.baseAmountMinor !== null ? { baseAmountMinor: updated.baseAmountMinor.toString() } : {}),
            closedAt: at.toISOString(),
            ownerUserId: updated.ownerUserId,
            occurredAt,
          } satisfies CrmDealWonV1,
          aggregateId: updated.id,
        });
      } else if (toStage.isLost) {
        events.push({
          name: CRM_EVENTS.DEAL_LOST_V1,
          payload: {
            organizationId: updated.organizationId,
            dealId: updated.id,
            // Non-null invariant: moveToStage (CRM-7) throws when a lost move
            // has no reason, so lostReasonCode is guaranteed set here.
            lostReasonCode: updated.lostReasonCode ?? '',
            closedAt: at.toISOString(),
            ownerUserId: updated.ownerUserId,
            occurredAt,
          } satisfies CrmDealLostV1,
          aggregateId: updated.id,
        });
      }

      return { result: { deal: Deal.fromPersistence(updated) }, events };
    });

    for (const event of committed.events) this.unitOfWork.addEvent(event);
    await this.unitOfWork.publishEvents();
    return committed.result;
  }
}

function toPlainDecimal(value: number): string {
  const text = value.toString();
  if (!text.includes('e')) return text;
  const [coefficient = '', exponentText = '0'] = text.split('e');
  const exponent = Number(exponentText);
  const [whole = '', fraction = ''] = coefficient.split('.');
  const digits = whole + fraction;
  const decimalIndex = whole.length + exponent;
  if (decimalIndex <= 0) return `0.${'0'.repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}
