import { Money } from '@modubiz/money';
import { describe, expect, it } from 'vitest';

import { CrmError, CRM_ERROR_CODE, Deal, type DealData, type DealStageHistoryData } from '../../domain/index.js';

function makeHistory(overrides: Partial<DealStageHistoryData> = {}): DealStageHistoryData {
  return {
    id: 'history-1',
    organizationId: 'org-1',
    dealId: 'deal-1',
    fromStageId: null,
    toStageId: 'stage-1',
    movedAt: new Date('2026-01-01T00:00:00Z'),
    movedBy: 'user-1',
    durationSeconds: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeDealData(overrides: Partial<DealData> = {}): DealData {
  return {
    id: 'deal-1',
    organizationId: 'org-1',
    title: 'Big deal',
    pipelineId: 'pipeline-1',
    stageId: 'stage-1',
    contactId: 'contact-1',
    companyId: null,
    valueAmountMinor: 100_000n,
    valueCurrency: 'USD',
    exchangeRate: null,
    baseAmountMinor: null,
    expectedCloseDate: null,
    status: 'open',
    closedAt: null,
    lostReasonCode: null,
    ownerUserId: 'user-1',
    stageHistory: [makeHistory()],
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

describe('CRM-10: a deal must reference a contact or a company', () => {
  it('accepts a deal with a contact', () => {
    const deal = Deal.create(makeDealData());
    expect(deal.contactId).toBe('contact-1');
  });

  it('accepts a deal with a company', () => {
    const deal = Deal.create(makeDealData({ contactId: null, companyId: 'company-1' }));
    expect(deal.companyId).toBe('company-1');
  });

  it('rejects a deal referencing neither contact nor company', () => {
    expectCrmError(
      () => Deal.create(makeDealData({ contactId: null, companyId: null })),
      CRM_ERROR_CODE.DEAL_REQUIRES_REFERENCE,
    );
  });
});

describe('CRM-6: every stage change appends history with elapsed duration', () => {
  it('appends a history row on a stage move', () => {
    const deal = Deal.create(makeDealData());
    const before = deal.stageHistory.length;

    const entry = deal.moveToStage({
      toStageId: 'stage-2',
      toStageIsWon: false,
      toStageIsLost: false,
      movedBy: 'user-1',
      at: new Date('2026-01-05T00:00:00Z'),
    });

    expect(deal.stageHistory).toHaveLength(before + 1);
    expect(entry.fromStageId).toBe('stage-1');
    expect(entry.toStageId).toBe('stage-2');
    expect(deal.stageId).toBe('stage-2');
  });

  it('records the elapsed duration in the previous stage', () => {
    // Entered stage-1 at 2026-01-01, moved to stage-2 at 2026-01-05 → 4 days.
    const deal = Deal.create(makeDealData());
    const entry = deal.moveToStage({
      toStageId: 'stage-2',
      toStageIsWon: false,
      toStageIsLost: false,
      movedBy: 'user-1',
      at: new Date('2026-01-05T00:00:00Z'),
    });
    expect(entry.durationSeconds).toBe(4 * 24 * 60 * 60);
  });
});

describe('CRM-7: moving to a lost stage requires a reason code', () => {
  it('rejects moving to a lost stage without a reason code', () => {
    const deal = Deal.create(makeDealData());
    expectCrmError(
      () =>
        deal.moveToStage({
          toStageId: 'stage-3',
          toStageIsWon: false,
          toStageIsLost: true,
          movedBy: 'user-1',
          at: new Date('2026-01-05T00:00:00Z'),
        }),
      CRM_ERROR_CODE.LOST_REASON_REQUIRED,
    );
  });

  it('accepts moving to a lost stage with a reason code', () => {
    const deal = Deal.create(makeDealData());
    deal.moveToStage({
      toStageId: 'stage-3',
      toStageIsWon: false,
      toStageIsLost: true,
      movedBy: 'user-1',
      at: new Date('2026-01-05T00:00:00Z'),
      lostReasonCode: 'lost_to_competitor',
    });
    expect(deal.status).toBe('lost');
    expect(deal.lostReasonCode).toBe('lost_to_competitor');
    expect(deal.closedAt).toEqual(new Date('2026-01-05T00:00:00Z'));
  });
});

describe('CRM-9: closing sets closed_at + status; reopen is traceable', () => {
  it('closing a deal as won sets status and closed_at', () => {
    const deal = Deal.create(makeDealData());
    deal.moveToStage({
      toStageId: 'stage-2',
      toStageIsWon: true,
      toStageIsLost: false,
      movedBy: 'user-1',
      at: new Date('2026-01-05T00:00:00Z'),
    });
    expect(deal.status).toBe('won');
    expect(deal.closedAt).toEqual(new Date('2026-01-05T00:00:00Z'));
  });

  it('rejects moving a closed deal directly to another stage', () => {
    const deal = Deal.create(makeDealData());
    deal.moveToStage({
      toStageId: 'stage-2',
      toStageIsWon: true,
      toStageIsLost: false,
      movedBy: 'user-1',
      at: new Date('2026-01-05T00:00:00Z'),
    });
    expectCrmError(
      () =>
        deal.moveToStage({
          toStageId: 'stage-1',
          toStageIsWon: false,
          toStageIsLost: false,
          movedBy: 'user-1',
          at: new Date('2026-01-06T00:00:00Z'),
        }),
      CRM_ERROR_CODE.DEAL_CLOSED_CANNOT_MOVE,
    );
  });

  it('CRM-9: reopening a closed deal appends history, never clears timestamps', () => {
    const deal = Deal.create(makeDealData());
    deal.moveToStage({
      toStageId: 'stage-2',
      toStageIsWon: true,
      toStageIsLost: false,
      movedBy: 'user-1',
      at: new Date('2026-01-05T00:00:00Z'),
    });
    const closedAt = deal.closedAt;
    const historyBefore = deal.stageHistory.length;

    const entry = deal.reopen({
      toStageId: 'stage-1',
      movedBy: 'user-1',
      at: new Date('2026-01-07T00:00:00Z'),
      hasDealWritePermission: true,
    });

    expect(deal.status).toBe('open');
    expect(deal.stageHistory).toHaveLength(historyBefore + 1);
    expect(entry.fromStageId).toBe('stage-2');
    // Timestamps are never cleared silently (CRM-9).
    expect(deal.closedAt).toEqual(closedAt);
    expect(entry.movedAt).toEqual(new Date('2026-01-07T00:00:00Z'));
  });

  it('rejects reopening without the crm:deal:write permission', () => {
    const deal = Deal.create(makeDealData());
    deal.moveToStage({
      toStageId: 'stage-2',
      toStageIsWon: true,
      toStageIsLost: false,
      movedBy: 'user-1',
      at: new Date('2026-01-05T00:00:00Z'),
    });
    expectCrmError(
      () =>
        deal.reopen({
          toStageId: 'stage-1',
          movedBy: 'user-1',
          at: new Date('2026-01-07T00:00:00Z'),
          hasDealWritePermission: false,
        }),
      CRM_ERROR_CODE.DEAL_REOPEN_PERMISSION,
    );
  });

  it('rejects reopening a deal that is still open', () => {
    const deal = Deal.create(makeDealData());
    expectCrmError(
      () =>
        deal.reopen({
          toStageId: 'stage-1',
          movedBy: 'user-1',
          at: new Date('2026-01-07T00:00:00Z'),
          hasDealWritePermission: true,
        }),
      CRM_ERROR_CODE.DEAL_NOT_CLOSED,
    );
  });
});

describe('CRM-8: deal value carries its own currency + FX snapshot', () => {
  it('stores no snapshot when the value currency matches the base currency', () => {
    const deal = Deal.create(makeDealData());
    deal.setValue(Money.of(250_000n, 'USD'), 'USD', null);
    expect(deal.value.amountMinor).toBe(250_000n);
    expect(deal.value.currency).toBe('USD');
    expect(deal.exchangeRate).toBeNull();
    expect(deal.toJSON().baseAmountMinor).toBeNull();
  });

  it('snapshots the FX rate when the value currency differs from the base', () => {
    const deal = Deal.create(makeDealData());
    deal.setValue(Money.of(250_000n, 'EUR'), 'USD', {
      rate: 1.08,
      source: 'test',
      validOn: new Date('2026-01-01T00:00:00Z'),
    });
    expect(deal.exchangeRate).toBe(1.08);
    expect(deal.toJSON().baseAmountMinor).not.toBeNull();
    expect(deal.toJSON().baseAmountMinor).toBeGreaterThan(0n);
  });

  it('rejects storing a non-base currency value without an FX rate', () => {
    const deal = Deal.create(makeDealData());
    expectCrmError(() => deal.setValue(Money.of(250_000n, 'EUR'), 'USD', null), CRM_ERROR_CODE.DEAL_FX_RATE_REQUIRED);
  });
});

describe('Deal data integrity', () => {
  it('rejects a negative deal value', () => {
    expectCrmError(() => Deal.create(makeDealData({ valueAmountMinor: -1n })), CRM_ERROR_CODE.DEAL_VALUE_NEGATIVE);
  });

  it('CRM-9: rejects a closed deal without closed_at', () => {
    expectCrmError(
      () => Deal.create(makeDealData({ status: 'won', closedAt: null })),
      CRM_ERROR_CODE.DEAL_CLOSED_AT_REQUIRED,
    );
  });

  it('CRM-7: rejects a lost deal without a lost_reason_code', () => {
    expectCrmError(
      () => Deal.create(makeDealData({ status: 'lost', closedAt: new Date('2026-01-05T00:00:00Z') })),
      CRM_ERROR_CODE.LOST_REASON_REQUIRED,
    );
  });
});
