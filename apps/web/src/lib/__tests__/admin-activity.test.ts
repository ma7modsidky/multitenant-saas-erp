import { describe, expect, it } from 'vitest';

import { activityDays, activityMeta, activityModuleKey } from '../admin-activity';

describe('admin-activity helpers (PLT-4 activity feed)', () => {
  it('maps every known module action to an icon, tone, and i18n key', () => {
    expect(activityMeta('module.trial.extended')).toMatchObject({
      labelKey: 'actTrialExtended',
      hasDays: true,
      tone: 'default',
    });
    expect(activityMeta('module.trial.stopped')).toMatchObject({ labelKey: 'actTrialStopped', tone: 'warning' });
    expect(activityMeta('module.trialing')).toMatchObject({ labelKey: 'actTrialGranted', tone: 'success' });
    expect(activityMeta('module.active')).toMatchObject({ labelKey: 'actFullAccess', tone: 'success' });
    expect(activityMeta('module.blocked')).toMatchObject({ labelKey: 'actBlocked', tone: 'destructive' });
    expect(activityMeta('module.suspended')).toMatchObject({ labelKey: 'actSuspended', tone: 'warning' });
    expect(activityMeta('module.activated')).toMatchObject({ labelKey: 'actActivated', tone: 'success' });
    expect(activityMeta('module.disabled')).toMatchObject({ labelKey: 'actDisabled', tone: 'muted' });
  });

  it('falls back to a generic row for unknown actions', () => {
    const meta = activityMeta('module.anything.else');
    expect(meta.labelKey).toBe('actDefault');
    expect(meta.hasDays).toBe(false);
    expect(meta.icon).toBeDefined();
  });

  it('reads the days param from metadata (trial extensions)', () => {
    expect(activityDays({ moduleKey: 'crm', days: 7 })).toBe(7);
    expect(activityDays({ moduleKey: 'crm' })).toBeUndefined();
    expect(activityDays({ days: 'not-a-number' })).toBeUndefined();
    expect(activityDays(null)).toBeUndefined();
  });

  it('reads the moduleKey from metadata', () => {
    expect(activityModuleKey({ moduleKey: 'crm', days: 7 })).toBe('crm');
    expect(activityModuleKey({ state: 'blocked' })).toBeNull();
    expect(activityModuleKey(null)).toBeNull();
  });
});
