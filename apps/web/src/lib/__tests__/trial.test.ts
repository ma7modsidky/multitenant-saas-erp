import { afterEach, describe, expect, it, vi } from 'vitest';

import { trialDaysLeft } from '../trial';

afterEach(() => {
  vi.useRealTimers();
});

describe('trialDaysLeft', () => {
  it('counts whole days remaining (ceiling, so a partial day still counts)', () => {
    const now = new Date('2026-08-14T10:00:00Z').getTime();
    vi.setSystemTime(now);
    expect(trialDaysLeft('2026-08-19T10:00:00Z')).toBe(5);
    // 1ms short of 5 full days still shows 5 (final partial day counts).
    expect(trialDaysLeft('2026-08-19T09:59:59Z')).toBe(5);
  });

  it('returns 0 once the end date has passed', () => {
    const now = new Date('2026-08-14T10:00:00Z').getTime();
    vi.setSystemTime(now);
    expect(trialDaysLeft('2026-08-14T09:59:59Z')).toBe(0);
  });

  it('returns 0 for an invalid date', () => {
    expect(trialDaysLeft('not-a-date')).toBe(0);
  });
});
