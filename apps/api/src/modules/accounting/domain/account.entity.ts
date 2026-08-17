import { ACCOUNTING_ERROR_CODE, AccountingDomainError } from './errors.js';

/** Chart of accounts account type (ACC-5: the five standard SME categories). */
export const ACCOUNT_TYPE = {
  ASSET: 'asset',
  LIABILITY: 'liability',
  EQUITY: 'equity',
  REVENUE: 'revenue',
  EXPENSE: 'expense',
} as const;

export type AccountType = (typeof ACCOUNT_TYPE)[keyof typeof ACCOUNT_TYPE];

/** A single chart-of-accounts account (pure domain — ACC-5). */
export interface AccountData {
  id: string;
  organizationId: string;
  /** Unique per org. System accounts can never be renumbered. */
  code: string;
  nameI18n: Record<string, string>;
  type: AccountType;
  parentId: string | null;
  /** ACC-5: system accounts cannot be deleted or renumbered. */
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Account — an entry in the organization's chart of accounts.
 *
 * Rules enforced here:
 *  - ACC-5: system accounts are immutable in code (they may only be renamed in
 *    `nameI18n`). Renumbering or deleting one is a domain error.
 */
export class Account {
  private constructor(private readonly data: AccountData) {}

  static create(input: {
    id: string;
    organizationId: string;
    code: string;
    nameI18n: Record<string, string>;
    type: AccountType;
    parentId?: string | null;
    isSystem?: boolean;
    isActive?: boolean;
    now?: Date;
  }): Account {
    const code = input.code.trim();
    if (!code) {
      throw new AccountingDomainError('ACCOUNTING_ACCOUNT_CODE_REQUIRED', 'An account requires a code.');
    }
    const timestamp = (input.now ?? new Date()).toISOString();
    return new Account({
      id: input.id,
      organizationId: input.organizationId,
      code,
      nameI18n: input.nameI18n,
      type: input.type,
      parentId: input.parentId ?? null,
      isSystem: input.isSystem ?? false,
      isActive: input.isActive ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  toJSON(): AccountData {
    return { ...this.data };
  }

  get id(): string {
    return this.data.id;
  }

  get code(): string {
    return this.data.code;
  }

  get type(): AccountType {
    return this.data.type;
  }

  get isSystem(): boolean {
    return this.data.isSystem;
  }

  get isActive(): boolean {
    return this.data.isActive;
  }

  /**
   * ACC-5: system accounts cannot be deleted or renumbered — but they may be
   * renamed (name_i18n is display text, not the accounting identity).
   */
  assertMutableCode(): void {
    if (this.data.isSystem) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.SYSTEM_ACCOUNT_IMMUTABLE,
        `System account ${this.data.code} cannot be deleted or renumbered (ACC-5).`,
        { code: this.data.code },
      );
    }
  }

  /**
   * ACC-5: update display metadata on an existing account. The code (the
   * accounting identity) never changes — only the display name and/or the
   * active flag may be edited. The name must be a non-empty plain string.
   */
  update(patch: { name?: string; isActive?: boolean }, now: Date): void {
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name === '') {
        throw new AccountingDomainError(
          ACCOUNTING_ERROR_CODE.ACCOUNT_NAME_REQUIRED,
          'An account name cannot be empty (ACC-5).',
        );
      }
      this.data.nameI18n = { ...this.data.nameI18n, en: name };
    }
    if (patch.isActive !== undefined) {
      this.data.isActive = patch.isActive;
    }
    this.data.updatedAt = now.toISOString();
  }
}

/** The default SME chart of accounts seeded once per org (ACC-5, lazy ensure). */
export const DEFAULT_SME_COA: ReadonlyArray<{
  code: string;
  type: AccountType;
  nameKey: string;
  isSystem: boolean;
}> = [
  // Assets
  { code: '1000', type: ACCOUNT_TYPE.ASSET, nameKey: 'coa.cash', isSystem: true },
  { code: '1100', type: ACCOUNT_TYPE.ASSET, nameKey: 'coa.bank', isSystem: true },
  { code: '1200', type: ACCOUNT_TYPE.ASSET, nameKey: 'coa.accounts_receivable', isSystem: true },
  { code: '1300', type: ACCOUNT_TYPE.ASSET, nameKey: 'coa.inventory', isSystem: true },
  // Liabilities
  { code: '2000', type: ACCOUNT_TYPE.LIABILITY, nameKey: 'coa.accounts_payable', isSystem: true },
  { code: '2100', type: ACCOUNT_TYPE.LIABILITY, nameKey: 'coa.vat_payable', isSystem: true },
  // Equity
  { code: '3000', type: ACCOUNT_TYPE.EQUITY, nameKey: 'coa.owner_equity', isSystem: true },
  // Revenue
  { code: '4000', type: ACCOUNT_TYPE.REVENUE, nameKey: 'coa.revenue', isSystem: true },
  { code: '4100', type: ACCOUNT_TYPE.REVENUE, nameKey: 'coa.service_revenue', isSystem: true },
  // Expenses
  { code: '5000', type: ACCOUNT_TYPE.EXPENSE, nameKey: 'coa.cogs', isSystem: true },
  { code: '5100', type: ACCOUNT_TYPE.EXPENSE, nameKey: 'coa.operating_expense', isSystem: true },
];

/**
 * Build the lazy, idempotent COA seed (ACC-5): the default SME chart. The
 * caller (EnsureDefaultChartOfAccountsUseCase) inserts only accounts whose
 * codes do not yet exist, inside a tenant-bound transaction.
 */
export function buildDefaultSmeChart(input: {
  organizationId: string;
  nameResolver: (nameKey: string) => Record<string, string>;
}): AccountData[] {
  // Fixed-point zero timestamps make the seed deterministic for tests.
  return DEFAULT_SME_COA.map((acc) =>
    Account.create({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      code: acc.code,
      nameI18n: input.nameResolver(acc.nameKey),
      type: acc.type,
      isSystem: acc.isSystem,
      isActive: true,
      now: new Date(0),
    }).toJSON(),
  ).sort((a, b) => a.code.localeCompare(b.code));
}
