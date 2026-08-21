import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { buildDefaultSmeChart, DEFAULT_SME_COA, type AccountData } from '../domain/index.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from './ports/index.js';

/**
 * EnsureDefaultChartOfAccountsUseCase — ACC-5 via lazy idempotent ensure
 * (CRM-3 pattern): the first COA read / journal write seeds the default SME
 * chart if none exists. Idempotent by construction — only missing codes are
 * inserted, inside a tenant-bound transaction.
 *
 * The generated `db/seed-on-enable.ts` scaffold was deleted: there is no
 * on-enable hook (the descriptor's `onEnableSeed` stays declared-but-unused).
 */
@Injectable()
export class EnsureDefaultChartOfAccountsUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  /** Insert the default SME chart iff the org has no accounts. Returns the chart. */
  async execute(): Promise<AccountData[]> {
    const organizationId = TenantContext.requireOrganizationId();

    return this.txManager.run(async (tx) => {
      const existing = await this.repo.listAccounts(tx);
      if (existing.length > 0) {
        // ACC-5: forward-fill any missing SYSTEM seed accounts (e.g. the Input
        // VAT 2200 account added in a later seed revision) without duplicating
        // existing codes — keeps existing orgs idempotent.
        const existingCodes = new Set(existing.map((row) => row.code));
        const missing = DEFAULT_SME_COA.filter((acc) => !existingCodes.has(acc.code));
        if (missing.length > 0) {
          const chart = buildDefaultSmeChart({
            organizationId,
            nameResolver: (nameKey) => defaultNameI18n(nameKey),
          });
          const toInsert = chart.filter((acc) => !existingCodes.has(acc.code));
          if (toInsert.length > 0) {
            await this.repo.insertAccounts(toInsert, tx);
          }
        }
        return existing.map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          code: row.code,
          nameI18n: row.nameI18n,
          type: row.type as AccountData['type'],
          parentId: row.parentId,
          isSystem: row.isSystem,
          isActive: row.isActive,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }));
      }

      const chart = buildDefaultSmeChart({
        organizationId,
        nameResolver: (nameKey) => defaultNameI18n(nameKey),
      });
      await this.repo.insertAccounts(chart, tx);
      return chart;
    });
  }

  /** Ensure + return the org's COA (read path — also seeds lazily). */
  async ensureAndList(): Promise<AccountData[]> {
    const organizationId = TenantContext.requireOrganizationId();
    await this.execute();
    return this.txManager.run((tx) =>
      this.repo.listAccounts(tx).then((rows) =>
        rows.map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          code: row.code,
          nameI18n: row.nameI18n,
          type: row.type as AccountData['type'],
          parentId: row.parentId,
          isSystem: row.isSystem,
          isActive: row.isActive,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
      ),
    );
  }
}

/** Default i18n names for the SME chart (keys are translated in the frontend). */
function defaultNameI18n(nameKey: string): Record<string, string> {
  return { en: nameKey };
}
