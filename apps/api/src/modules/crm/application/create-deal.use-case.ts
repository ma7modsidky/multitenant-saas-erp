import { Money, type FxRate } from '@modubiz/money';
import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import type { TxOrDb } from '../../../core/database/repository.base.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Deal, type PipelineData } from '../domain/index.js';

import { EnsureDefaultPipelineUseCase } from './ensure-default-pipeline.use-case.js';
import { DEAL_REPOSITORY, PIPELINE_REPOSITORY, type DealRepository, type PipelineRepository } from './ports/index.js';

export interface CreateDealInput {
  title: string;
  contactId?: string | null;
  companyId?: string | null;
  /** Optional pipeline; when omitted the org's default pipeline is ensured (CRM-3). */
  pipelineId?: string | null;
  /** Optional stage; when omitted the pipeline's first stage is used. */
  stageId?: string | null;
  value: Money;
  /** Org base currency (resolved by the API layer from org settings). */
  baseCurrency: string;
  /** Optional FX snapshot when value currency ≠ base currency (CUR-5/CRM-8). */
  fxRate?: FxRate | null;
  expectedCloseDate?: Date | null;
  ownerUserId?: string | null;
}

/**
 * CreateDealUseCase — creates a CRM deal. Owns its transaction.
 *
 * Business rules:
 * - CRM-10: a deal must reference a contact or a company (domain invariant).
 * - CRM-3: the first deal write lazily ensures exactly one default pipeline;
 *   a second call is a no-op.
 * - CRM-8: the deal value carries its own currency; when it differs from the
 *   org base currency the FX snapshot is stored (exchange_rate +
 *   base_amount_minor).
 */
@Injectable()
export class CreateDealUseCase {
  constructor(
    @Inject(DEAL_REPOSITORY)
    private readonly dealRepo: DealRepository,
    @Inject(PIPELINE_REPOSITORY)
    private readonly pipelineRepo: PipelineRepository,
    private readonly ensureDefaultPipeline: EnsureDefaultPipelineUseCase,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: CreateDealInput): Promise<{ deal: Deal }> {
    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const result = await this.txManager.run(async (tx) => {
      // CRM-3: lazy idempotent ensure of the default pipeline.
      const pipeline: PipelineData =
        input.pipelineId === null || input.pipelineId === undefined
          ? await this.ensureDefaultPipeline.ensure(tx)
          : await this.loadPipeline(input.pipelineId, tx);

      // Resolve the stage: explicit, or the pipeline's first (position 0).
      const stageId =
        input.stageId ??
        pipeline.stages
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((s) => s.id)[0];
      if (!stageId) {
        throw new NotFoundError('PIPELINE_NO_STAGES');
      }

      const deal = Deal.create({
        id: crypto.randomUUID(),
        organizationId,
        title: input.title,
        pipelineId: pipeline.id,
        stageId,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
        valueAmountMinor: input.value.amountMinor,
        valueCurrency: input.value.currency,
        exchangeRate: null,
        baseAmountMinor: null,
        expectedCloseDate: input.expectedCloseDate ?? null,
        status: 'open',
        closedAt: null,
        lostReasonCode: null,
        ownerUserId: input.ownerUserId ?? null,
        stageHistory: [],
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
      });

      // CRM-8: snapshot the FX rate when the value currency differs from base.
      deal.setValue(input.value, input.baseCurrency, input.fxRate ?? null);

      const persisted = await this.dealRepo.insert(deal.toJSON(), tx);
      return { deal: Deal.fromPersistence(persisted) };
    });

    // No event is declared for deal creation — stage changes publish events
    // from MoveDealStageUseCase/CloseDealUseCase. Nothing to publish here.
    return result;
  }

  private async loadPipeline(pipelineId: string, tx: TxOrDb): Promise<PipelineData> {
    const pipeline = await this.pipelineRepo.findById(pipelineId, tx);
    if (!pipeline) {
      throw new NotFoundError('PIPELINE_NOT_FOUND', { pipelineId });
    }
    return pipeline;
  }
}
