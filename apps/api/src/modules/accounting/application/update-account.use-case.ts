import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { EntitlementService } from '../../../core/entitlements/entitlement.service.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Account, ACCOUNTING_ERROR_CODE, AccountingDomainError } from '../domain/index.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

export interface UpdateAccountInput {
  accountId: string;
  /** Display name (plain text) — replaces the `en` name_i18n entry (ACC-5). */
  name?: string;
  /** Toggle the account active/inactive (custom accounts only). */
  isActive?: boolean;
}

/**
 * UpdateAccountUseCase — edit an existing chart-of-accounts account: rename it
 * and/or toggle its active status. The CODE (the accounting identity) never
 * changes (ACC-5). Renaming is allowed for any account (name_i18n is display
 * text); deactivating a SYSTEM account is rejected — the seeded chart is the
 * backbone every posting resolves against (ACC-5 immutability in spirit).
 *
 * ACC-16: like creation, the update path is gated on the `advanced_coa` plan
 * feature — without it the chart is read-only (fails closed).
 */
@Injectable()
export class UpdateAccountUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
    private readonly entitlements: EntitlementService,
  ) {}

  async execute(input: UpdateAccountInput): Promise<{ accountId: string }> {
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
      const row = await this.repo.findAccountById(input.accountId, tx);
      if (!row) throw new NotFoundError('Account not found', { accountId: input.accountId });

      const account = Account.create({
        id: row.id,
        organizationId: row.organizationId,
        code: row.code,
        nameI18n: row.nameI18n,
        type: row.type as Parameters<typeof Account.create>[0]['type'],
        parentId: row.parentId,
        isSystem: row.isSystem,
        isActive: row.isActive,
        now: new Date(row.updatedAt),
      });

      // ACC-5: the seeded chart's activation state is part of its identity —
      // deactivating a system account would silently break every posting that
      // resolves against it. Custom accounts may be toggled freely.
      if (input.isActive !== undefined && row.isSystem && input.isActive !== row.isActive) {
        throw new AccountingDomainError(
          ACCOUNTING_ERROR_CODE.SYSTEM_ACCOUNT_IMMUTABLE,
          `System account ${row.code} cannot be deactivated (ACC-5).`,
          { code: row.code },
        );
      }

      account.update(
        {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        new Date(),
      );

      await this.repo.updateAccount(
        input.accountId,
        {
          ...(input.name !== undefined ? { name: account.toJSON().nameI18n.en } : {}),
          ...(input.isActive !== undefined ? { isActive: account.toJSON().isActive } : {}),
        },
        tx,
      );
      return { accountId: input.accountId };
    });
  }
}
