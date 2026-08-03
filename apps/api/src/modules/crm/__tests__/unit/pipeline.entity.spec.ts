import { describe, expect, it } from 'vitest';

import {
  CrmError,
  CRM_ERROR_CODE,
  Pipeline,
  PipelineStage,
  type PipelineData,
  type PipelineStageData,
} from '../../domain/index.js';

function makeStage(overrides: Partial<PipelineStageData> = {}): PipelineStageData {
  return {
    id: 'stage-1',
    organizationId: 'org-1',
    pipelineId: 'pipeline-1',
    nameI18n: { en: 'Open' },
    position: 0,
    probability: 20,
    isWon: false,
    isLost: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

function makePipelineData(overrides: Partial<PipelineData> = {}): PipelineData {
  return {
    id: 'pipeline-1',
    organizationId: 'org-1',
    nameI18n: { en: 'Sales' },
    isDefault: false,
    stages: [
      makeStage({ id: 'stage-1', position: 0 }),
      makeStage({ id: 'stage-2', position: 1, isWon: true }),
      makeStage({ id: 'stage-3', position: 2, isLost: true }),
    ],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

function expectCrmError(action: () => void, expectedCode: string): void {
  try {
    action();
    expect.fail('Expected CrmError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(CrmError);
    expect((error as CrmError).code).toBe(expectedCode);
  }
}

describe('CRM-4: a pipeline needs ≥1 stage, exactly one is_won and one is_lost', () => {
  it('creates a valid pipeline with won + lost stages', () => {
    const pipeline = Pipeline.create(makePipelineData());
    expect(pipeline.stages).toHaveLength(3);
    expect(pipeline.isDefault).toBe(false);
  });

  it('rejects a pipeline with no stages', () => {
    expectCrmError(() => Pipeline.create(makePipelineData({ stages: [] })), CRM_ERROR_CODE.PIPELINE_INVALID_STAGES);
  });

  it('rejects a pipeline without exactly one is_won and one is_lost stage', () => {
    const noTerminal = makePipelineData({ stages: [makeStage({ id: 'stage-1', position: 0 })] });
    expectCrmError(() => Pipeline.create(noTerminal), CRM_ERROR_CODE.PIPELINE_INVALID_STAGES);
  });

  it('rejects a pipeline with two is_won stages', () => {
    const twoWon = makePipelineData({
      stages: [
        makeStage({ id: 'stage-1', position: 0 }),
        makeStage({ id: 'stage-2', position: 1, isWon: true }),
        makeStage({ id: 'stage-3', position: 2, isWon: true }),
        makeStage({ id: 'stage-4', position: 3, isLost: true }),
      ],
    });
    expectCrmError(() => Pipeline.create(twoWon), CRM_ERROR_CODE.PIPELINE_INVALID_STAGES);
  });

  it('rejects adding a stage that breaks the won/lost invariant', () => {
    const pipeline = Pipeline.create(makePipelineData());
    // Adding another is_won stage must be rejected.
    expectCrmError(
      () => pipeline.addStage(makeStage({ id: 'stage-9', isWon: true }), 'user-1'),
      CRM_ERROR_CODE.PIPELINE_INVALID_STAGES,
    );
  });
});

describe('CRM-5: stage positions are contiguous and unique', () => {
  it('rejects non-contiguous stage positions', () => {
    const gapped = makePipelineData({
      stages: [
        makeStage({ id: 'stage-1', position: 0 }),
        makeStage({ id: 'stage-2', position: 5, isWon: true }),
        makeStage({ id: 'stage-3', position: 6, isLost: true }),
      ],
    });
    expectCrmError(() => Pipeline.create(gapped), CRM_ERROR_CODE.PIPELINE_POSITIONS_NOT_CONTIGUOUS);
  });

  it('rejects duplicate positions', () => {
    const duplicated = makePipelineData({
      stages: [
        makeStage({ id: 'stage-1', position: 0 }),
        makeStage({ id: 'stage-2', position: 0, isWon: true }),
        makeStage({ id: 'stage-3', position: 2, isLost: true }),
      ],
    });
    expectCrmError(() => Pipeline.create(duplicated), CRM_ERROR_CODE.PIPELINE_POSITIONS_NOT_CONTIGUOUS);
  });

  it('appends a new stage at the next contiguous position', () => {
    const pipeline = Pipeline.create(makePipelineData());
    const added = pipeline.addStage(makeStage({ id: 'stage-4' }), 'user-1');
    expect(added.position).toBe(3);
    expect(pipeline.stages).toHaveLength(4);
  });

  it('reorders stages atomically rewriting positions', () => {
    const pipeline = Pipeline.create(makePipelineData());
    pipeline.reorderStages(['stage-3', 'stage-1', 'stage-2'], 'user-1');
    expect(pipeline.stages.map((s) => s.id)).toEqual(['stage-3', 'stage-1', 'stage-2']);
    expect(pipeline.stages.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it('rejects a reorder that omits a stage', () => {
    const pipeline = Pipeline.create(makePipelineData());
    expectCrmError(
      () => pipeline.reorderStages(['stage-1', 'stage-2'], 'user-1'),
      CRM_ERROR_CODE.PIPELINE_POSITIONS_NOT_CONTIGUOUS,
    );
  });

  it('rejects a reorder containing an unknown stage', () => {
    const pipeline = Pipeline.create(makePipelineData());
    expectCrmError(
      () => pipeline.reorderStages(['stage-1', 'stage-2', 'ghost'], 'user-1'),
      CRM_ERROR_CODE.PIPELINE_POSITIONS_NOT_CONTIGUOUS,
    );
  });

  it('rejects a reorder with duplicate stage ids', () => {
    const pipeline = Pipeline.create(makePipelineData());
    expectCrmError(
      () => pipeline.reorderStages(['stage-1', 'stage-1', 'stage-2'], 'user-1'),
      CRM_ERROR_CODE.PIPELINE_POSITIONS_NOT_CONTIGUOUS,
    );
  });
});

describe('PipelineStage probability invariant (via addStage)', () => {
  it('rejects adding a stage with probability outside 0..100', () => {
    const pipeline = Pipeline.create(makePipelineData());
    expectCrmError(
      () => pipeline.addStage(makeStage({ id: 'stage-9', probability: 150 }), 'user-1'),
      CRM_ERROR_CODE.PIPELINE_INVALID_STAGES,
    );
  });
});

describe('CRM-3: the default pipeline cannot be deleted', () => {
  it('allows deleting a non-default pipeline', () => {
    const pipeline = Pipeline.create(makePipelineData());
    pipeline.markDeleted('user-1', new Date('2026-02-01T00:00:00Z'));
    expect(pipeline.deletedAt).toEqual(new Date('2026-02-01T00:00:00Z'));
  });

  it('rejects deleting the default pipeline', () => {
    const pipeline = Pipeline.create(makePipelineData({ isDefault: true }));
    expectCrmError(() => pipeline.markDeleted('user-1'), CRM_ERROR_CODE.PIPELINE_DEFAULT_DELETE);
  });
});

describe('PipelineStage probability invariant', () => {
  it('accepts a probability of exactly 100', () => {
    const stage = PipelineStage.create(makeStage({ probability: 100 }));
    expect(stage.probability).toBe(100);
  });

  it('rejects a probability outside 0..100', () => {
    expectCrmError(() => PipelineStage.create(makeStage({ probability: 101 })), CRM_ERROR_CODE.PIPELINE_INVALID_STAGES);
  });
});
