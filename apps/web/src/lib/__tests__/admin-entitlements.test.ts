import { describe, expect, it, vi, afterEach } from 'vitest';

import { actionsFor, enableModesFor, extendedTrialEnd } from '../admin-entitlements';

describe('extendedTrialEnd (mirrors the backend extend rule)', () => {
  afterEach(() => vi.restoreAllMocks());

  const DAY = 24 * 60 * 60 * 1000;

  it('adds days to the CURRENT end when the trial is still running', () => {
    const inTenDays = Date.now() + 10 * DAY;
    const end = extendedTrialEnd('trialing', new Date(inTenDays).toISOString(), 3);
    // 10 days remaining + 3 = 13 days out (never shortened, never from now).
    expect(end.getTime() - inTenDays).toBeCloseTo(3 * DAY, -6);
  });

  it('adds days from NOW when the trial has lapsed (current end in the past)', () => {
    const lapsed = Date.now() - 5 * DAY;
    const end = extendedTrialEnd('expired', new Date(lapsed).toISOString(), 14);
    expect(end.getTime() - Date.now()).toBeCloseTo(14 * DAY, -6);
  });

  it('BUGFIX: adds days from NOW for a manually STOPPED trial whose stored end is still in the future', () => {
    // Stop a 14-day trial on day 1: state `expired`, trialEndsAt still 13 days
    // out. Extending by 2 must preview ~2 days from now — never 13 + 2 = 15.
    const staleFutureEnd = Date.now() + 13 * DAY;
    const end = extendedTrialEnd('expired', new Date(staleFutureEnd).toISOString(), 2);
    expect(end.getTime() - Date.now()).toBeCloseTo(2 * DAY, -6);
    expect(end.getTime()).toBeLessThan(staleFutureEnd);
  });

  it('adds days from NOW when there is no current end', () => {
    const end = extendedTrialEnd('trialing', null, 7);
    expect(end.getTime() - Date.now()).toBeCloseTo(7 * DAY, -6);
  });

  it('falls back to now for an invalid date string', () => {
    const end = extendedTrialEnd('trialing', 'not-a-date', 7);
    expect(end.getTime() - Date.now()).toBeCloseTo(7 * DAY, -6);
  });
});

describe('actionsFor (PLT-8)', () => {
  it('available offers the single enable dialog entry', () => {
    expect(actionsFor('available', false, true, false)).toEqual(['enable']);
  });

  it('trialing offers extend/stop/block/disable — block stops the trial AND gates it', () => {
    expect(actionsFor('trialing', true, true, false)).toEqual(['extend-trial', 'stop-trial', 'block', 'disable']);
  });

  it('active offers suspend ONLY for paid modules (BILL-6)', () => {
    expect(actionsFor('active', false, true, true)).toEqual(['suspend', 'disable']);
    expect(actionsFor('active', false, true, false)).toEqual(['disable']);
  });

  it('expired offers enable + revive + disable regardless of trial usage', () => {
    expect(actionsFor('expired', true, true, false)).toEqual(['enable', 'extend-trial', 'disable']);
    expect(actionsFor('expired', false, true, false)).toEqual(['enable', 'extend-trial', 'disable']);
  });

  it('blocked can be lifted (enable) or removed (disable)', () => {
    expect(actionsFor('blocked', false, true, false)).toEqual(['enable', 'disable']);
  });
});

describe('enableModesFor (BILL-2 + block gate)', () => {
  it('offers trial + full + block when the trial is unused and not blocked', () => {
    expect(enableModesFor('available', false)).toEqual(['trial', 'full', 'block']);
  });

  it('hides the trial mode once the BILL-2 stamp is set', () => {
    expect(enableModesFor('disabled', true)).toEqual(['full', 'block']);
  });

  it('hides the block mode when already blocked (unblock = full or trial)', () => {
    expect(enableModesFor('blocked', false)).toEqual(['trial', 'full']);
  });
});
