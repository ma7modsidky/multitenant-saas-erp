import { Inject, Injectable } from '@nestjs/common';

import type { TxOrDb } from '../../../core/database/repository.base.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Pipeline, type PipelineData, type PipelineStageData } from '../domain/index.js';

import { PIPELINE_REPOSITORY, type PipelineRepository } from './ports/index.js';

/**
 * EnsureDefaultPipelineUseCase — CRM-3 lazy idempotent ensure.
 *
 * The first pipeline read / deal write for an organization calls `ensure()`
 * (inside the caller's transaction). It creates the standard pipeline iff no
 * default exists — a second call is a no-op. No framework lifecycle hook is
 * involved (PLAN.md §4.5 decision, PROGRESS.md Session 21).
 */
@Injectable()
export class EnsureDefaultPipelineUseCase {
  constructor(
    @Inject(PIPELINE_REPOSITORY)
    private readonly pipelineRepo: PipelineRepository,
    private readonly txManager: TransactionManager,
  ) {}

  /** Standalone entry point (opens its own transaction). */
  async execute(): Promise<PipelineData> {
    return this.txManager.run((tx) => this.ensure(tx));
  }

  /**
   * CRM-3: ensure the organization has exactly one default pipeline.
   * Call this INSIDE the caller's transaction (the first deal write does).
   * Idempotent: returns the existing default when one exists.
   */
  async ensure(tx: TxOrDb): Promise<PipelineData> {
    const existing = await this.pipelineRepo.findDefault(tx);
    if (existing) return existing;

    const organizationId = TenantContext.requireOrganizationId();
    const userId = TenantContext.getUserId() ?? null;
    const now = new Date();

    const stages: PipelineStageData[] = [
      {
        id: crypto.randomUUID(),
        organizationId,
        pipelineId: 'placeholder',
        nameI18n: { en: 'New' },
        position: 0,
        probability: 10,
        isWon: false,
        isLost: false,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
      },
      {
        id: crypto.randomUUID(),
        organizationId,
        pipelineId: 'placeholder',
        nameI18n: { en: 'Qualified' },
        position: 1,
        probability: 40,
        isWon: false,
        isLost: false,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
      },
      {
        id: crypto.randomUUID(),
        organizationId,
        pipelineId: 'placeholder',
        nameI18n: { en: 'Won' },
        position: 2,
        probability: 100,
        isWon: true,
        isLost: false,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
      },
      {
        id: crypto.randomUUID(),
        organizationId,
        pipelineId: 'placeholder',
        nameI18n: { en: 'Lost' },
        position: 3,
        probability: 0,
        isWon: false,
        isLost: true,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
        deletedAt: null,
      },
    ];

    const pipelineId = crypto.randomUUID();
    const pipeline = Pipeline.create({
      id: pipelineId,
      organizationId,
      nameI18n: { en: 'Sales Pipeline' },
      isDefault: true,
      stages: stages.map((s) => ({ ...s, pipelineId })),
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
    });

    return this.pipelineRepo.insert(pipeline.toJSON(), tx);
  }
}
