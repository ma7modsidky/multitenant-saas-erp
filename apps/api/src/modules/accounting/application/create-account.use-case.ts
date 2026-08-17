import { Inject, Injectable } from '@nestjs/common';

import { ConflictError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { EntitlementService } from '../../../core/entitlements/entitlement.service.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ACCOUNTING_ERROR_CODE, Account, AccountingDomainError, type AccountType } from '../domain/index.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

export interface CreateAccountInput {
  /** 4-digit numeric code, unique per org (matches the seeded SME chart). */
  code: string;
  /** Display name stored as the `en` nameI18n entry (fallback for other locales). */
  name: string;
  type: AccountType;
  parentId?: string | null;
}

/**
 * CreateAccountUseCase — adds a custom account to the org's chart of accounts.
 *
 * ACC-16: custom accounts are a plan-gated feature (`accounting.advanced_coa`).
 * When the feature is absent the chart is read-only — system accounts are
 * immutable (ACC-5) and no new accounts may be added (ACCOUNTING_COA_READ_ONLY).
 * When enabled, the org can extend the chart; codes stay unique per org.
 */
@Injectable()
export class CreateAccountUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
    private readonly entitlements: EntitlementService,
  ) {}

  async execute(input: CreateAccountInput): Promise<{ accountId: string; code: string }> {
    const organizationId = TenantContext.requireOrganizationId();

    // ACC-16: the entitlement row's feature set is the runtime authority
    // (BILL-4). A missing or empty set fails closed → read-only.
    const advancedCoa = await this.entitlements.isFeatureEnabled(organizationId, 'accounting', 'advanced_coa');
    if (!advancedCoa) {
      throw new AccountingDomainError(
        ACCOUNTING_ERROR_CODE.COA_READ_ONLY,
        'Custom accounts require the advanced chart of accounts feature (ACC-16).',
      );
    }

    return this.txManager.run(async (tx) => {
      const code = input.code.trim();

      // ACC-5/ACC-16: account codes are unique per org.
      const existing = await this.repo.findAccountByCode(code, tx);
      if (existing) {
        throw new ConflictError(ACCOUNTING_ERROR_CODE.ACCOUNT_CODE_EXISTS, `Account code ${code} already exists.`, {
          code,
        });
      }

      const account = Account.create({
        id: crypto.randomUUID(),
        organizationId,
        code,
        nameI18n: { en: input.name },
        type: input.type,
        ...(input.parentId !== undefined && input.parentId !== null ? { parentId: input.parentId } : {}),
        isSystem: false,
        isActive: true,
      });

      await this.repo.insertAccounts([account.toJSON()], tx);
      return { accountId: account.id, code: account.code };
    });
  }
}
