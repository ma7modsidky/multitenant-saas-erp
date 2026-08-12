'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';

/**
 * Badge variant + i18n label per entitlement state. `none` deliberately has
 * NO entry: a not-yet-activated module shows no badge (a raw `none` chip
 * meant nothing to users). Unknown states fall back to no badge too.
 */
const STATE_BADGES: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; labelKey: string }> =
  {
    active: { variant: 'default', labelKey: 'modules.state.active' },
    trialing: { variant: 'secondary', labelKey: 'modules.state.trial' },
    past_due: { variant: 'destructive', labelKey: 'modules.state.pastDue' },
    disabled: { variant: 'outline', labelKey: 'modules.state.disabled' },
    expired: { variant: 'outline', labelKey: 'modules.state.expired' },
    suspended: { variant: 'destructive', labelKey: 'modules.state.suspended' },
  };

/**
 * ModuleStateBadge — the localized state chip shared by the module
 * marketplace and the billing page. Renders nothing for `none`/unknown
 * states, so a raw state code can never reach the UI.
 */
export function ModuleStateBadge({ state }: { state: string }) {
  const t = useTranslations();
  const badge = STATE_BADGES[state];
  if (!badge) return null;
  return <Badge variant={badge.variant}>{t(badge.labelKey)}</Badge>;
}
