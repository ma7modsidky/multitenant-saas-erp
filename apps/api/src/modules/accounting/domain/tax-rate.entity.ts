import { ACCOUNTING_ERROR_CODE, AccountingDomainError } from './errors.js';

export const TAX_TYPE = {
  STANDARD: 'standard',
  REDUCED: 'reduced',
  ZERO: 'zero',
  EXEMPT: 'exempt',
} as const;

export type TaxType = (typeof TAX_TYPE)[keyof typeof TAX_TYPE];

export interface TaxRateData {
  id: string;
  organizationId: string;
  /** Unique per org. */
  code: string;
  nameI18n: Record<string, string>;
  /** ACC-11: rate in basis points (1% = 100 bp). */
  rateBp: number;
  type: TaxType;
  effectiveFrom: string; // ISO date
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * TaxRate — a per-org tax rate (ACC-11). Standard, reduced, zero-rated, and
 * exempt are the four supported types; a zero-rated rate still has type
 * `zero` with rateBp 0, while `exempt` carries no tax at all.
 */
export class TaxRate {
  private constructor(private readonly data: TaxRateData) {}

  static create(input: {
    id: string;
    organizationId: string;
    code: string;
    nameI18n: Record<string, string>;
    rateBp: number;
    type?: TaxType;
    effectiveFrom?: string;
    isActive?: boolean;
    now?: Date;
  }): TaxRate {
    const code = input.code.trim();
    if (!code) {
      throw new AccountingDomainError('ACCOUNTING_TAX_CODE_REQUIRED', 'A tax rate requires a code.');
    }
    if (!Number.isInteger(input.rateBp) || input.rateBp < 0) {
      throw new AccountingDomainError(
        'ACCOUNTING_TAX_RATE_INVALID',
        `Tax rate bp must be a non-negative integer, got ${input.rateBp}.`,
        { rateBp: input.rateBp },
      );
    }
    // ACC-11: only standard/reduced carry a positive rate; zero/exempt are 0.
    const type = input.type ?? TAX_TYPE.STANDARD;
    if ((type === TAX_TYPE.ZERO || type === TAX_TYPE.EXEMPT) && input.rateBp !== 0) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.TAX_MISMATCH,
        `A ${type} tax rate must have rateBp 0 (ACC-11).`,
        { type, rateBp: input.rateBp },
      );
    }
    const timestamp = (input.now ?? new Date()).toISOString();
    return new TaxRate({
      id: input.id,
      organizationId: input.organizationId,
      code,
      nameI18n: input.nameI18n,
      rateBp: input.rateBp,
      type,
      effectiveFrom: input.effectiveFrom ?? new Date().toISOString().slice(0, 10),
      isActive: input.isActive ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  toJSON(): TaxRateData {
    return { ...this.data };
  }

  get id(): string {
    return this.data.id;
  }

  get rateBp(): number {
    return this.data.rateBp;
  }

  get type(): TaxType {
    return this.data.type;
  }
}
