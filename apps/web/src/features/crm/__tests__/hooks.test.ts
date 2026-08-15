import { describe, expect, it } from 'vitest';

import { activitiesKey, companiesKey, contactsKey, dealColumnDateRange } from '../hooks';

/**
 * Board column date presets. Deals store `updated_at` as a UTC instant and
 * the read repository filters `updated_at >= fromDate::date AND updated_at <
 * (toDate::date + interval '1 day')` in the database session timezone (UTC).
 * The presets must therefore be computed in UTC — a local-time computation
 * shifted the window by the browser's UTC offset, hiding deals created in the
 * early hours (local) from the default "today" column and leaving the board
 * stuck on "Nothing here yet" while the table listed them.
 */
const FIXED = new Date('2026-08-13T14:30:00.000Z');

describe('dealColumnDateRange', () => {
  it('computes the "today" window from the instant\'s UTC date', () => {
    expect(dealColumnDateRange('today', FIXED)).toEqual({ fromDate: '2026-08-13', toDate: '2026-08-13' });
  });

  it('keeps a deal created at the same instant inside the "today" window (boundary regression)', () => {
    const { fromDate, toDate } = dealColumnDateRange('today', FIXED);
    // The deal's updated_at is the same UTC instant; the repository bound is
    // [fromDate::date, toDate::date + 1 day) in UTC.
    const now = FIXED.toISOString();
    expect(now >= `${fromDate}T00:00:00.000Z`).toBe(true);
    const dayAfter = new Date(`${toDate}T00:00:00.000Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    expect(new Date(now).getTime()).toBeLessThan(dayAfter.getTime());
  });

  it('spans the rolling 7 UTC days for "week", ending today', () => {
    expect(dealColumnDateRange('week', FIXED)).toEqual({ fromDate: '2026-08-07', toDate: '2026-08-13' });
  });

  it('starts "month" on the first day of the current UTC month', () => {
    expect(dealColumnDateRange('month', FIXED)).toEqual({ fromDate: '2026-08-01', toDate: '2026-08-13' });
  });

  it('returns no date bounds for "all"', () => {
    expect(dealColumnDateRange('all', FIXED)).toEqual({});
  });
});

describe('table list query keys include the sort (sort-header regression)', () => {
  it('changes the contacts key when sortBy/sortDir change, so react-query refetches', () => {
    const base = contactsKey({ page: 1 });
    const byName = contactsKey({ page: 1, sortBy: 'name', sortDir: 'asc' });
    const byEmailDesc = contactsKey({ page: 1, sortBy: 'email', sortDir: 'desc' });

    expect(byName).not.toEqual(base);
    expect(byEmailDesc).not.toEqual(byName);
    // The URL-driven params are in the key, not just page/pageSize.
    expect(byName).toContain('name');
    expect(byName).toContain('asc');
  });

  it('changes the companies key when the sort changes', () => {
    const base = companiesKey({ page: 1 });
    const sorted = companiesKey({ page: 1, sortBy: 'industry', sortDir: 'asc' });
    expect(sorted).not.toEqual(base);
    expect(sorted).toContain('industry');
  });

  it('changes the activities key when the sort changes', () => {
    const base = activitiesKey({ page: 1 });
    const sorted = activitiesKey({ page: 1, sortBy: 'dueAt', sortDir: 'asc' });
    expect(sorted).not.toEqual(base);
    expect(sorted).toContain('dueAt');
  });
});
