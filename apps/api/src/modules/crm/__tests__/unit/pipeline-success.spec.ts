import { describe, expect, it } from 'vitest';

import { stageSuccessPercent, type PipelineStageData, type StageOutcomeCounts } from '../../domain/index.js';

function makeStage(overrides: Partial<PipelineStageData> = {}): PipelineStageData {
  return {
    id: 'stage-1',
    organizationId: 'org-1',
    pipelineId: 'pipeline-1',
    nameI18n: { en: 'Qualified' },
    position: 0,
    probability: 40,
    isWon: false,
    isLost: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

describe('CRM-17: stage success percentage', () => {
  it('falls back to the configured probability while no deal has resolved from the stage', () => {
    expect(stageSuccessPercent(makeStage({ probability: 40 }), undefined)).toBe(40);
    expect(stageSuccessPercent(makeStage({ probability: 40 }), { won: 0, lost: 0 })).toBe(40);
  });

  it('computes the win rate once deals have resolved (won / (won + lost))', () => {
    const counts: StageOutcomeCounts = { won: 3, lost: 1 };
    expect(stageSuccessPercent(makeStage({ probability: 40 }), counts)).toBe(75);
  });

  it('rounds the win rate half-up to an integer percentage', () => {
    expect(stageSuccessPercent(makeStage(), { won: 1, lost: 2 })).toBe(33);
    expect(stageSuccessPercent(makeStage(), { won: 2, lost: 1 })).toBe(67);
  });

  it('clamps the configured fallback into 0..100', () => {
    expect(stageSuccessPercent(makeStage({ probability: 130 }), undefined)).toBe(100);
    expect(stageSuccessPercent(makeStage({ probability: -5 }), undefined)).toBe(0);
  });

  it('yields 0% and 100% for fully lost / fully won stages', () => {
    expect(stageSuccessPercent(makeStage({ probability: 50 }), { won: 0, lost: 7 })).toBe(0);
    expect(stageSuccessPercent(makeStage({ probability: 50 }), { won: 5, lost: 0 })).toBe(100);
  });

  it('never divides by zero for a won/lost-free stage with zero counts', () => {
    expect(() => stageSuccessPercent(makeStage(), { won: 0, lost: 0 })).not.toThrow();
  });
});
