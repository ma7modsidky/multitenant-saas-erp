/**
 * Allow-listed SaaS settings keys (PLT-7). Anything outside this set is
 * rejected with UNKNOWN_SAAS_SETTING.
 */
export const SAAS_SETTINGS_KEYS = ['platformName', 'supportEmail', 'trialDurationDays', 'allowSelfSignup'] as const;

export type SaasSettingKey = (typeof SAAS_SETTINGS_KEYS)[number];

/** Platform admin tried to write a settings key that is not allow-listed (PLT-7). */
export const UNKNOWN_SAAS_SETTING = 'UNKNOWN_SAAS_SETTING';
