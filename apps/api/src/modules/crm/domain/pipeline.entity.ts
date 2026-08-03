import { CrmError, CRM_ERROR_CODE } from './errors.js';

/**
 * Persisted shape of a pipeline stage (crm_pipeline_stages).
 */
export interface PipelineStageData {
  id: string;
  organizationId: string;
  pipelineId: string;
  nameI18n: Record<string, string>;
  position: number;
  probability: number; // 0..100
  isWon: boolean;
  isLost: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
}

/**
 * Persisted shape of a pipeline (crm_pipelines) including its stages.
 */
export interface PipelineData {
  id: string;
  organizationId: string;
  nameI18n: Record<string, string>;
  isDefault: boolean;
  stages: PipelineStageData[];
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
}

/**
 * PipelineStage — an ordered stage within a pipeline.
 *
 * Pure TypeScript, no framework imports (hard rule #7).
 * Holds the stage-level invariants (probability range).
 */
export class PipelineStage {
  private constructor(private readonly data: PipelineStageData) {}

  static create(data: PipelineStageData): PipelineStage {
    assertStageValid(data);
    return new PipelineStage({ ...data });
  }

  static fromPersistence(data: PipelineStageData): PipelineStage {
    return new PipelineStage(data);
  }

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get pipelineId(): string {
    return this.data.pipelineId;
  }
  get nameI18n(): Record<string, string> {
    return this.data.nameI18n;
  }
  get position(): number {
    return this.data.position;
  }
  get probability(): number {
    return this.data.probability;
  }
  get isWon(): boolean {
    return this.data.isWon;
  }
  get isLost(): boolean {
    return this.data.isLost;
  }
  get deletedAt(): Date | null {
    return this.data.deletedAt;
  }

  toJSON(): PipelineStageData {
    return { ...this.data };
  }
}

/**
 * Pipeline — a collection of ordered stages a deal moves through.
 *
 * Business rules enforced here:
 * - CRM-3: exactly one default pipeline per organization (the flag flip is
 *   validated by the DB partial unique index; deletion of the default is
 *   rejected here).
 * - CRM-4: a pipeline has at least one stage, exactly one is_won stage, and
 *   exactly one is_lost stage.
 * - CRM-5: stage positions are contiguous and unique within a pipeline;
 *   reordering rewrites positions atomically.
 */
export class Pipeline {
  private constructor(private readonly data: PipelineData) {}

  static create(data: PipelineData): Pipeline {
    assertStageSetValid(data.stages);
    return new Pipeline({ ...data, stages: data.stages.map((s) => ({ ...s })) });
  }

  /** Reconstruct from persistence (already valid — no invariant re-check). */
  static fromPersistence(data: PipelineData): Pipeline {
    return new Pipeline(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get nameI18n(): Record<string, string> {
    return this.data.nameI18n;
  }
  get isDefault(): boolean {
    return this.data.isDefault;
  }
  get deletedAt(): Date | null {
    return this.data.deletedAt;
  }
  get stages(): readonly PipelineStageData[] {
    return this.data.stages.map((s) => ({ ...s }));
  }

  /** Get all data as a plain object. */
  toJSON(): PipelineData {
    return { ...this.data, stages: this.data.stages.map((s) => ({ ...s })) };
  }

  // ─── Behaviour ──────────────────────────────────────────────────────────────

  /**
   * Appends a stage at the next contiguous position (CRM-5).
   * Re-validates CRM-4 after the change.
   */
  addStage(stage: Omit<PipelineStageData, 'position'>, by: string): PipelineStageData {
    const next: PipelineStageData = {
      ...stage,
      position: this.data.stages.length,
    };
    assertStageValid(next);
    const stages = [...this.data.stages, next];
    assertStageSetValid(stages);
    this.data.stages = stages;
    this.data.updatedBy = by;
    this.data.updatedAt = new Date();
    return next;
  }

  /**
   * CRM-5: reorders stages atomically.
   *
   * `orderedStageIds` lists every stage id in its new order. Positions are
   * rewritten 0..n-1 as a single mutation — a rejected reorder never leaves a
   * partially-rewritten pipeline.
   */
  reorderStages(orderedStageIds: readonly string[], by: string): void {
    if (
      orderedStageIds.length !== this.data.stages.length ||
      new Set(orderedStageIds).size !== orderedStageIds.length
    ) {
      throw new CrmError(
        CRM_ERROR_CODE.PIPELINE_POSITIONS_NOT_CONTIGUOUS,
        'Reordering must include every stage exactly once.',
      );
    }
    const byId = new Map(this.data.stages.map((s) => [s.id, s]));
    const reordered: PipelineStageData[] = [];
    orderedStageIds.forEach((id, i) => {
      const stage = byId.get(id);
      if (!stage) {
        throw new CrmError(
          CRM_ERROR_CODE.PIPELINE_POSITIONS_NOT_CONTIGUOUS,
          `Unknown stage id "${id}" in reorder request.`,
        );
      }
      reordered.push({ ...stage, position: i });
    });
    assertStageSetValid(reordered);
    this.data.stages = reordered;
    this.data.updatedBy = by;
    this.data.updatedAt = new Date();
  }

  /**
   * CRM-3: soft-deletes the pipeline.
   * The default pipeline cannot be deleted while it remains the default.
   */
  markDeleted(by: string, at = new Date()): void {
    if (this.data.isDefault) {
      throw new CrmError(
        CRM_ERROR_CODE.PIPELINE_DEFAULT_DELETE,
        'The default pipeline cannot be deleted. Promote another pipeline first.',
      );
    }
    this.data.deletedAt = at;
    this.data.updatedBy = by;
    this.data.updatedAt = at;
  }
}

/**
 * Stage-level invariant: probability is a percentage 0..100 (DB CHECK).
 */
function assertStageValid(data: PipelineStageData): void {
  if (data.probability < 0 || data.probability > 100) {
    throw new CrmError(
      CRM_ERROR_CODE.PIPELINE_INVALID_STAGES,
      `Stage probability must be between 0 and 100 (got ${data.probability}).`,
    );
  }
}

/**
 * CRM-4 + CRM-5: validates a stage collection as a whole.
 * - at least one stage
 * - exactly one is_won and exactly one is_lost
 * - positions are 0..n-1, contiguous and unique
 */
function assertStageSetValid(stages: readonly PipelineStageData[]): void {
  if (stages.length === 0) {
    throw new CrmError(CRM_ERROR_CODE.PIPELINE_INVALID_STAGES, 'A pipeline must have at least one stage.');
  }
  const wonCount = stages.filter((s) => s.isWon).length;
  const lostCount = stages.filter((s) => s.isLost).length;
  if (wonCount !== 1 || lostCount !== 1) {
    throw new CrmError(
      CRM_ERROR_CODE.PIPELINE_INVALID_STAGES,
      `A pipeline must have exactly one is_won stage and one is_lost stage (got ${wonCount} won, ${lostCount} lost).`,
    );
  }
  const positions = stages.map((s) => s.position).sort((a, b) => a - b);
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] !== i) {
      throw new CrmError(
        CRM_ERROR_CODE.PIPELINE_POSITIONS_NOT_CONTIGUOUS,
        'Stage positions must be contiguous and unique starting at 0.',
      );
    }
  }
}
