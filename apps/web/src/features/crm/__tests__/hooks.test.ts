import { describe, expect, it } from 'vitest';

import { activitiesKey, companiesKey, contactsKey, isCrmListPreset, scopePresetListParams } from '../hooks';

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

describe('scopePresetListParams — TEAM-4 chips map to the deals/activities API params', () => {
  it('maps "Assigned to me" to scope=mine (strictly records assigned to me)', () => {
    expect(scopePresetListParams('mine')).toEqual({ scope: 'mine' });
  });

  it('maps "Team pool" to pool=team and "Unassigned" to pool=global', () => {
    expect(scopePresetListParams('teamPool')).toEqual({ pool: 'team' });
    expect(scopePresetListParams('unassigned')).toEqual({ pool: 'global' });
  });

  it('maps "Created recently" to a 30-day createdFrom bound', () => {
    const params = scopePresetListParams('recent', new Date('2026-01-31T12:00:00Z'));
    expect(params.createdFrom).toBe('2026-01-01');
  });

  it('sends no ownership params for the All preset', () => {
    expect(scopePresetListParams('all')).toEqual({});
  });

  it('isCrmListPreset accepts only the five chip values', () => {
    for (const value of ['all', 'mine', 'teamPool', 'unassigned', 'recent']) {
      expect(isCrmListPreset(value)).toBe(true);
    }
    expect(isCrmListPreset('bogus')).toBe(false);
    expect(isCrmListPreset(null)).toBe(false);
  });
});
