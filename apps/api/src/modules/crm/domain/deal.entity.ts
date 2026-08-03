import { Money, type FxRate } from '@modubiz/money';

import { CrmError, CRM_ERROR_CODE } from './errors.js';

/** Deal lifecycle status (crm_deals.status — DB CHECK). */
export type DealStatus = 'open' | 'won' | 'lost';

/**
 * Append-only ledger entry of a stage transition (crm_deal_stage_history).
 *
 * No updated_at/deleted_at by design (CRM-6 — nothing may ever be edited).
 */
export interface DealStageHistoryData {
  id: string;
  organizationId: string;
  dealId: string;
  fromStageId: string | null;
  toStageId: string;
  movedAt: Date;
  movedBy: string;
  durationSeconds: number;
  createdAt: Date;
}

/**
 * Persisted shape of a CRM deal (crm_deals).
 *
 * Money columns follow DATA_MODEL §5: integer minor units + ISO currency pair.
 */
export interface DealData {
  id: string;
  organizationId: string;
  title: string;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  companyId: string | null;
  valueAmountMinor: bigint;
  valueCurrency: string;
  /** FX rate snapshot (value currency -> org base currency) at write time (CUR-5). */
  exchangeRate: number | null;
  /** value converted to base currency at write time (null when currencies match). */
  baseAmountMinor: bigint | null;
  expectedCloseDate: Date | null;
  status: DealStatus;
  closedAt: Date | null;
  lostReasonCode: string | null;
  ownerUserId: string | null;
  stageHistory: DealStageHistoryData[];
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
}

/**
 * Deal — an opportunity moving through a pipeline.
 *
 * Pure TypeScript, no framework imports (hard rule #7).
 *
 * Business rules enforced here:
 * - CRM-6: every stage change appends a row to the stage history with the
 *   elapsed duration in the previous stage; history is append-only.
 * - CRM-7: moving to a lost stage requires a lost_reason_code.
 * - CRM-8: the deal value carries its own currency; when it differs from the
 *   org base currency the FX snapshot (CUR-5) is stored on the deal.
 * - CRM-9: closing (won or lost) sets closed_at + status; a closed deal may be
 *   reopened only with crm:deal:write, appending a history entry — timestamps
 *   are never cleared silently.
 * - CRM-10: a deal must reference a contact or a company (at least one).
 */
export class Deal {
  private constructor(private readonly data: DealData) {}

  static create(data: DealData): Deal {
    assertReferences(data);
    assertValueNonNegative(data);
    assertStatusCoherent(data);
    return new Deal({ ...data, stageHistory: [...data.stageHistory] });
  }

  /** Reconstruct from persistence (already valid — no invariant re-check). */
  static fromPersistence(data: DealData): Deal {
    return new Deal(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get title(): string {
    return this.data.title;
  }
  get pipelineId(): string {
    return this.data.pipelineId;
  }
  get stageId(): string {
    return this.data.stageId;
  }
  get contactId(): string | null {
    return this.data.contactId;
  }
  get companyId(): string | null {
    return this.data.companyId;
  }
  get value(): Money {
    return Money.of(this.data.valueAmountMinor, this.data.valueCurrency);
  }
  get exchangeRate(): number | null {
    return this.data.exchangeRate;
  }
  get expectedCloseDate(): Date | null {
    return this.data.expectedCloseDate;
  }
  get status(): DealStatus {
    return this.data.status;
  }
  get closedAt(): Date | null {
    return this.data.closedAt;
  }
  get lostReasonCode(): string | null {
    return this.data.lostReasonCode;
  }
  get ownerUserId(): string | null {
    return this.data.ownerUserId;
  }
  get stageHistory(): readonly DealStageHistoryData[] {
    return this.data.stageHistory.map((h) => ({ ...h }));
  }
  get deletedAt(): Date | null {
    return this.data.deletedAt;
  }

  /** Get all data as a plain object. */
  toJSON(): DealData {
    return { ...this.data, stageHistory: this.data.stageHistory.map((h) => ({ ...h })) };
  }

  // ─── Behaviour ──────────────────────────────────────────────────────────────

  /**
   * CRM-8: sets the deal value with an FX snapshot.
   *
   * - If `value.currency` equals the org base currency: no conversion is
   *   stored (exchange_rate and base_amount_minor stay null).
   * - Otherwise an FX rate is required and snapshotted: `exchange_rate` =
   *   the rate used, `base_amount_minor` = value converted to base currency
   *   at write time (CUR-5 — rates are never re-read later).
   */
  setValue(value: Money, baseCurrency: string, fxRate: FxRate | null): void {
    assertValueNonNegative({ valueAmountMinor: value.amountMinor, valueCurrency: value.currency });
    this.data.valueAmountMinor = value.amountMinor;
    this.data.valueCurrency = value.currency;

    if (value.currency === baseCurrency) {
      this.data.exchangeRate = null;
      this.data.baseAmountMinor = null;
      return;
    }
    if (fxRate === null) {
      throw new CrmError(
        CRM_ERROR_CODE.DEAL_FX_RATE_REQUIRED,
        `An FX rate is required to store a deal value in ${value.currency} (org base: ${baseCurrency}).`,
      );
    }
    const converted = value.convertTo(baseCurrency, fxRate);
    this.data.exchangeRate = converted.exchangeRate;
    this.data.baseAmountMinor = converted.amountMinor;
  }

  /**
   * CRM-6 + CRM-7 + CRM-9: moves the deal to another stage (or closes it).
   *
   * - Appends a history entry with the elapsed duration in the previous stage.
   * - If the target stage is won/lost the deal closes: `closed_at` is set and
   *   `status` becomes won/lost (CRM-9); a lost target requires
   *   `lost_reason_code` (CRM-7).
   * - A closed deal cannot move directly — reopen it first (CRM-9).
   *
   * @returns the appended history entry, so the use case can persist it and
   *          publish `crm.deal.stage_changed.v1` (and won/lost) after commit.
   */
  moveToStage(opts: {
    toStageId: string;
    toStageIsWon: boolean;
    toStageIsLost: boolean;
    movedBy: string;
    at: Date;
    lostReasonCode?: string | null;
  }): DealStageHistoryData {
    if (this.data.status !== 'open') {
      throw new CrmError(
        CRM_ERROR_CODE.DEAL_CLOSED_CANNOT_MOVE,
        'A closed deal must be reopened before its stage can change again.',
      );
    }
    if (opts.toStageIsLost && (opts.lostReasonCode === undefined || opts.lostReasonCode === null)) {
      throw new CrmError(
        CRM_ERROR_CODE.LOST_REASON_REQUIRED,
        'Moving a deal to a lost stage requires a lost_reason_code.',
      );
    }

    const enteredAt = this.stageEnteredAt();
    const durationSeconds = Math.max(0, Math.floor((opts.at.getTime() - enteredAt.getTime()) / 1000));
    const entry: DealStageHistoryData = {
      id: crypto.randomUUID(),
      organizationId: this.data.organizationId,
      dealId: this.data.id,
      fromStageId: this.data.stageId,
      toStageId: opts.toStageId,
      movedAt: opts.at,
      movedBy: opts.movedBy,
      durationSeconds,
      createdAt: opts.at,
    };

    this.data.stageHistory = [...this.data.stageHistory, entry];
    this.data.stageId = opts.toStageId;

    if (opts.toStageIsWon) {
      this.data.status = 'won';
      this.data.closedAt = opts.at;
      this.data.lostReasonCode = null;
    } else if (opts.toStageIsLost) {
      this.data.status = 'lost';
      this.data.closedAt = opts.at;
      this.data.lostReasonCode = opts.lostReasonCode ?? null;
    }
    this.data.updatedAt = opts.at;
    this.data.updatedBy = opts.movedBy;
    return entry;
  }

  /**
   * CRM-9: reopens a closed deal.
   *
   * - Requires the `crm:deal:write` permission (permission checked by the use
   *   case via @RequiresPermission and passed in for the domain invariant).
   * - Appends a history entry so the close/reopen cycle is fully traceable.
   * - Timestamps are NEVER cleared silently: `closed_at` and
   *   `lost_reason_code` are preserved as historical record — a reopened deal
   *   that closes again gets a fresh `closed_at` on the next close.
   */
  reopen(opts: {
    toStageId: string;
    movedBy: string;
    at: Date;
    hasDealWritePermission: boolean;
  }): DealStageHistoryData {
    if (!opts.hasDealWritePermission) {
      throw new CrmError(
        CRM_ERROR_CODE.DEAL_REOPEN_PERMISSION,
        'Reopening a closed deal requires the crm:deal:write permission.',
      );
    }
    if (this.data.status === 'open') {
      throw new CrmError(CRM_ERROR_CODE.DEAL_NOT_CLOSED, 'Only a closed deal can be reopened.');
    }

    const enteredAt = this.stageEnteredAt();
    const durationSeconds = Math.max(0, Math.floor((opts.at.getTime() - enteredAt.getTime()) / 1000));
    const entry: DealStageHistoryData = {
      id: crypto.randomUUID(),
      organizationId: this.data.organizationId,
      dealId: this.data.id,
      fromStageId: this.data.stageId,
      toStageId: opts.toStageId,
      movedAt: opts.at,
      movedBy: opts.movedBy,
      durationSeconds,
      createdAt: opts.at,
    };

    this.data.stageHistory = [...this.data.stageHistory, entry];
    this.data.stageId = opts.toStageId;
    this.data.status = 'open';
    // closed_at and lost_reason_code are intentionally NOT cleared (CRM-9).
    this.data.updatedAt = opts.at;
    this.data.updatedBy = opts.movedBy;
    return entry;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /** When the deal entered its current stage: last move's time, or creation. */
  private stageEnteredAt(): Date {
    const last = this.data.stageHistory[this.data.stageHistory.length - 1];
    return last ? last.movedAt : this.data.createdAt;
  }
}

/**
 * CRM-10: a deal must reference a contact or a company (at least one).
 */
function assertReferences(data: DealData): void {
  if (data.contactId === null && data.companyId === null) {
    throw new CrmError(CRM_ERROR_CODE.DEAL_REQUIRES_REFERENCE, 'A deal must reference a contact or a company.');
  }
}

/**
 * DATA_MODEL §5 — money is never negative (DB CHECK on value_amount_minor).
 */
function assertValueNonNegative(data: Pick<DealData, 'valueAmountMinor' | 'valueCurrency'>): void {
  if (data.valueAmountMinor < 0n) {
    throw new CrmError(CRM_ERROR_CODE.DEAL_VALUE_NEGATIVE, 'A deal value cannot be negative.');
  }
}

/**
 * Status coherence — mirrors the DB CHECKs on crm_deals:
 * - CRM-9: a closed deal (won or lost) must have closed_at set.
 * - CRM-7: a lost deal must have a lost_reason_code.
 */
function assertStatusCoherent(data: DealData): void {
  if (data.status !== 'open' && data.closedAt === null) {
    throw new CrmError(CRM_ERROR_CODE.DEAL_CLOSED_AT_REQUIRED, 'A closed deal must have a closed_at timestamp.');
  }
  if (data.status === 'lost' && data.lostReasonCode === null) {
    throw new CrmError(CRM_ERROR_CODE.LOST_REASON_REQUIRED, 'A lost deal requires a lost_reason_code.');
  }
}
