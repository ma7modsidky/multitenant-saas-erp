import { Inject, Injectable } from '@nestjs/common';

import { SAAS_SETTINGS_REPOSITORY, type SaasSettingsRepository } from '../ports/index.js';

export interface SaasSettings {
  platformName: string;
  supportEmail: string;
  trialDurationDays: number;
  allowSelfSignup: boolean;
}

/**
 * GetSaasSettingsUseCase — platform-level settings, completed with defaults so
 * the admin console always has a full view even before the boot sync seeded
 * every key.
 */
@Injectable()
export class GetSaasSettingsUseCase {
  constructor(
    @Inject(SAAS_SETTINGS_REPOSITORY)
    private readonly settingsRepo: SaasSettingsRepository,
  ) {}

  async execute(): Promise<SaasSettings> {
    const rows = await this.settingsRepo.getAll();
    const map = new Map(rows.map((r) => [r.key, r.value]));

    return {
      platformName: typeof map.get('platformName') === 'string' ? (map.get('platformName') as string) : 'ModuBiz',
      supportEmail: typeof map.get('supportEmail') === 'string' ? (map.get('supportEmail') as string) : '',
      trialDurationDays:
        typeof map.get('trialDurationDays') === 'number' ? (map.get('trialDurationDays') as number) : 14,
      allowSelfSignup: typeof map.get('allowSelfSignup') === 'boolean' ? (map.get('allowSelfSignup') as boolean) : true,
    };
  }
}
