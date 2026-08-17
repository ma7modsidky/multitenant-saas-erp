import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { OrganizationSettings } from '../domain/index.js';
import { ORGANIZATION_REPOSITORY, type OrganizationRepository } from '../ports/index.js';

/**
 * Input for updating organization settings.
 */
export interface UpdateOrganizationSettingsInput {
  organizationId: string;
  locale?: string;
  timezone?: string;
  baseCurrency?: string;
  numberPreferences?: Record<string, unknown>;
  datePreferences?: Record<string, unknown>;
  receiptFooter?: string | null;
  sellerTaxId?: string | null;
}

/**
 * UpdateOrganizationSettingsUseCase — updates organization settings.
 *
 * Organization settings are stored in core_organization_settings (RLS-protected).
 * Only OWNER and ADMIN roles may update settings (enforced by controller guard).
 */
@Injectable()
export class UpdateOrganizationSettingsUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly orgRepo: OrganizationRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: UpdateOrganizationSettingsInput): Promise<OrganizationSettings> {
    // core_organization_settings is an RLS-protected table, so both the read
    // and the upsert must happen inside TransactionManager.run() — reading
    // outside the tenant-bound transaction fails closed and would throw
    // ORG_SETTINGS_NOT_FOUND even though the row exists.
    const updated = await this.txManager.run(async (tx) => {
      const existing = await this.orgRepo.findSettingsByOrgId(input.organizationId, tx);

      if (!existing) {
        throw new NotFoundError('ORG_SETTINGS_NOT_FOUND', { organizationId: input.organizationId });
      }

      const merged: OrganizationSettings = OrganizationSettings.create({
        ...existing,
        locale: input.locale ?? existing.locale,
        timezone: input.timezone ?? existing.timezone,
        baseCurrency: input.baseCurrency ?? existing.baseCurrency,
        numberPreferences: input.numberPreferences ?? existing.numberPreferences,
        datePreferences: input.datePreferences ?? existing.datePreferences,
        receiptFooter: input.receiptFooter !== undefined ? input.receiptFooter : existing.receiptFooter,
        sellerTaxId: input.sellerTaxId !== undefined ? input.sellerTaxId : existing.sellerTaxId,
      });

      const persisted = await this.orgRepo.upsertSettings(merged.toJSON(), tx);
      return OrganizationSettings.fromPersistence(persisted);
    });

    return updated;
  }
}
