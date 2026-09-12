import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Deal, type DealData } from '../domain/index.js';
import { DEAL_REPOSITORY, type DealRepository } from './ports/index.js';

export interface UpdateDealInput {
  dealId: string;
  ownerUserId?: string | null;
  ownerTeamId?: string | null;
}

/**
 * UpdateDealUseCase — ownership edits only (TEAM-5): claim a pooled deal or
 * reassign its user/team owners. Stage transitions have their own use cases
 * (move/close/reopen); this path deliberately cannot touch them.
 */
@Injectable()
export class UpdateDealUseCase {
  constructor(
    @Inject(DEAL_REPOSITORY)
    private readonly dealRepo: DealRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: UpdateDealInput): Promise<{ deal: Deal }> {
    const updatedBy = TenantContext.getUserId() ?? null;
    const deal = await this.txManager.run(async (tx) => {
      const data = await this.dealRepo.findById(input.dealId, tx);
      if (!data) throw new NotFoundError('DEAL_NOT_FOUND', { dealId: input.dealId });

      const patch: Partial<DealData> = {};
      if (input.ownerUserId !== undefined) patch.ownerUserId = input.ownerUserId;
      if (input.ownerTeamId !== undefined) patch.ownerTeamId = input.ownerTeamId;
      patch.updatedBy = updatedBy;

      return this.dealRepo.update(input.dealId, patch, tx);
    });
    if (!deal) throw new NotFoundError('DEAL_NOT_FOUND', { dealId: input.dealId });
    return { deal: Deal.fromPersistence(deal) };
  }
}
