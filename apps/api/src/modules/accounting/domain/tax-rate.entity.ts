import { ACCOUNTING_ERROR_CODE, AccountingDomainError } from './errors.js';

export const TAX_TYPE = {
  STANDARD: 'standard',
  REDUCED: 'reduced',
  ZERO: 'zero',
  EXEMPT: 'exempt',
} as const;

export type TaxType = (typeof TAX_TYPE)[keyof typeof TAX_TYPE];

/** ACC-11: whether a rate is added on top of the line total or embedded in it. */
export const TAX_BASIS = {
  EXCLUSIVE: 'exclusive',
  INCLUSIVE: 'inclusive',
} as const;

export type TaxBasis = (typeof TAX_BASIS)[keyof typeof TAX_BASIS];

export interface TaxRateData {
  id: string;
  organizationId: string;
  /** Unique per org. */
  code: string;
  nameI18n: Record<string, string>;
  /** ACC-11: rate in basis points (1% = 100 bp). */
  rateBp: number;
  type: TaxType;
  /** ACC-11: exclusive (tax on top) or inclusive (tax embedded). */
  taxBasis: TaxBasis;
  /** GL account absorbing this rate's tax; NULL falls back to the seeded VAT account. */
  coaAccountId: string | null;
  /** ACC-11: at most one default rate per org. */
  isDefault: boolean;
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
    taxBasis?: TaxBasis;
    coaAccountId?: string | null;
    isDefault?: boolean;
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
    // ACC-11: zero/exempt rates are always exclusive — an inclusive 0% rate
    // is meaningless (it would compute tax 0 either way, but the catalog
    // stays explicit about the basis).
    const basis = input.taxBasis ?? TAX_BASIS.EXCLUSIVE;
    const timestamp = (input.now ?? new Date()).toISOString();
    return new TaxRate({
      id: input.id,
      organizationId: input.organizationId,
      code,
      nameI18n: input.nameI18n,
      rateBp: input.rateBp,
      type,
      taxBasis: basis,
      coaAccountId: input.coaAccountId ?? null,
      isDefault: input.isDefault ?? false,
      effectiveFrom: input.effectiveFrom ?? new Date().toISOString().slice(0, 10),
      isActive: input.isActive ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  /**
   * ACC-11: update display metadata + tax attributes. The code (the identity)
   * never changes; is_default uniqueness is enforced by the partial unique
   * index (one default per org).
   */
  update(
    patch: {
      nameI18n?: Record<string, string>;
      rateBp?: number;
      type?: TaxType;
      taxBasis?: TaxBasis;
      coaAccountId?: string | null;
      isDefault?: boolean;
      isActive?: boolean;
    },
    now: Date,
  ): void {
    if (patch.rateBp !== undefined) {
      if (!Number.isInteger(patch.rateBp) || patch.rateBp < 0) {
        throw new AccountingDomainError(
          'ACCOUNTING_TAX_RATE_INVALID',
          `Tax rate bp must be a non-negative integer, got ${patch.rateBp}.`,
          { rateBp: patch.rateBp },
        );
      }
      this.data.rateBp = patch.rateBp;
    }
    if (patch.type !== undefined) {
      const type = patch.type;
      if ((type === TAX_TYPE.ZERO || type === TAX_TYPE.EXEMPT) && this.data.rateBp !== 0) {
        throw new AccountingDomainError(
          ACCOUNTING_ERROR_CODE.TAX_MISMATCH,
          `A ${type} tax rate must have rateBp 0 (ACC-11).`,
          { type, rateBp: this.data.rateBp },
        );
      }
      this.data.type = type;
    }
    if (patch.nameI18n !== undefined) this.data.nameI18n = { ...this.data.nameI18n, ...patch.nameI18n };
    if (patch.taxBasis !== undefined) this.data.taxBasis = patch.taxBasis;
    if (patch.coaAccountId !== undefined) this.data.coaAccountId = patch.coaAccountId;
    if (patch.isDefault !== undefined) this.data.isDefault = patch.isDefault;
    if (patch.isActive !== undefined) this.data.isActive = patch.isActive;
    this.data.updatedAt = now.toISOString();
  }

  toJSON(): TaxRateData {
    return { ...this.data };
  }

  /** Rehydrate from a persisted TaxRateData (from the repository row). */
  static fromPersistence(data: TaxRateData): TaxRate {
    return new TaxRate(data);
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

  get taxBasis(): TaxBasis {
    return this.data.taxBasis;
  }

  get coaAccountId(): string | null {
    return this.data.coaAccountId;
  }

  get isDefault(): boolean {
    return this.data.isDefault;
  }
}
