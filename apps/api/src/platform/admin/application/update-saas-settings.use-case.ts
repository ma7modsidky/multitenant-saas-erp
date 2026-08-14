import { Inject, Injectable } from '@nestjs/common';

import { ValidationError } from '../../../core/common/errors.js';
import { SAAS_SETTINGS_KEYS, UNKNOWN_SAAS_SETTING, type SaasSettingKey } from '../domain/index.js';
import {
  PLATFORM_AUDIT_REPOSITORY,
  SAAS_SETTINGS_REPOSITORY,
  type PlatformAuditRepository,
  type SaasSettingsRepository,
} from '../ports/index.js';

/**
 * UpdateSaasSettingsUseCase — updates platform-level settings.
 *
 * PLT-7: only the allow-listed key set in core_saas_settings may be written;
 * any other key is rejected with 400 UNKNOWN_SAAS_SETTING. Value types are
 * validated per key. Every change is audited (PLT-4).
 */
@Injectable()
export class UpdateSaasSettingsUseCase {
  constructor(
    @Inject(SAAS_SETTINGS_REPOSITORY)
    private readonly settingsRepo: SaasSettingsRepository,
    @Inject(PLATFORM_AUDIT_REPOSITORY)
    private readonly auditRepo: PlatformAuditRepository,
  ) {}

  async execute(input: {
    settings: Record<string, unknown>;
    actorUserId: string | null;
    actorEmail: string | null;
  }): Promise<Record<string, unknown>> {
    const entries = Object.entries(input.settings);

    for (const [key, value] of entries) {
      if (!(SAAS_SETTINGS_KEYS as readonly string[]).includes(key)) {
        throw new ValidationError(UNKNOWN_SAAS_SETTING, `Unknown SaaS setting '${key}'`, { key });
      }
      this.assertValueType(key as SaasSettingKey, value);
    }

    const before = await this.settingsRepo.getAll();

    for (const [key, value] of entries) {
      await this.settingsRepo.set(key, value, input.actorUserId);
    }

    const after = await this.settingsRepo.getAll();

    await this.auditRepo.insert({
      action: 'settings.updated',
      entityType: 'saas',
      entityId: 'saas_settings',
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      before: Object.fromEntries(before.map((r) => [r.key, r.value])),
      after: Object.fromEntries(after.map((r) => [r.key, r.value])),
    });

    return Object.fromEntries(entries);
  }

  private assertValueType(key: SaasSettingKey, value: unknown): void {
    const valid =
      key === 'platformName'
        ? typeof value === 'string' && value.length > 0 && value.length <= 120
        : key === 'supportEmail'
          ? typeof value === 'string' && value.length <= 320
          : key === 'trialDurationDays'
            ? typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 365
            : typeof value === 'boolean';

    if (!valid) {
      throw new ValidationError('VALIDATION_ERROR', `Invalid value for SaaS setting '${key}'`, { key });
    }
  }
}
