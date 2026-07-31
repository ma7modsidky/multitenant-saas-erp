import { describe, expect, it } from 'vitest';

import { Organization, OrganizationError, type OrganizationData } from '../domain/index.js';

function makeOrgData(overrides: Partial<OrganizationData> = {}): OrganizationData {
  return {
    id: 'org-1',
    name: 'Acme Corp',
    slug: 'acme-corp',
    countryCode: 'US',
    timezone: 'America/New_York',
    baseCurrency: 'USD',
    defaultLocale: 'en',
    status: 'active',
    deletionScheduledAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function expectOrgError(action: () => void, expectedCode: string): void {
  try {
    action();
    expect.fail('Expected OrganizationError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(OrganizationError);
    expect((error as OrganizationError).code).toBe(expectedCode);
  }
}

describe('Organization.create()', () => {
  it('creates an organization from data', () => {
    const org = Organization.create(makeOrgData());
    expect(org.id).toBe('org-1');
    expect(org.name).toBe('Acme Corp');
    expect(org.status).toBe('active');
  });
});

describe('Organization.fromPersistence()', () => {
  it('restores an organization from stored data', () => {
    const data = makeOrgData();
    const org = Organization.fromPersistence(data);
    expect(org.slug).toBe('acme-corp');
    expect(org.baseCurrency).toBe('USD');
  });
});

describe('Organization.updateProfile()', () => {
  it('updates name', () => {
    const org = Organization.create(makeOrgData());
    org.updateProfile({ name: 'Acme Corp 2' });
    expect(org.name).toBe('Acme Corp 2');
  });

  it('updates multiple fields at once', () => {
    const org = Organization.create(makeOrgData());
    org.updateProfile({ countryCode: 'GB', timezone: 'Europe/London', baseCurrency: 'GBP' });
    expect(org.countryCode).toBe('GB');
    expect(org.timezone).toBe('Europe/London');
    expect(org.baseCurrency).toBe('GBP');
  });

  it('does not change fields that are not provided', () => {
    const org = Organization.create(makeOrgData());
    org.updateProfile({ name: 'New Name' });
    expect(org.name).toBe('New Name');
    expect(org.countryCode).toBe('US');
  });

  it('does not change fields when props is empty', () => {
    const org = Organization.create(makeOrgData());
    org.updateProfile({});
    expect(org.name).toBe('Acme Corp');
    expect(org.baseCurrency).toBe('USD');
  });
});

describe('GDPR-2: Organization soft-delete', () => {
  it('scheduleDeletion sets status to pending_deletion with 30-day grace period', () => {
    const org = Organization.create(makeOrgData());
    const before = Date.now();
    org.scheduleDeletion();

    expect(org.status).toBe('pending_deletion');
    expect(org.deletionScheduledAt).toBeInstanceOf(Date);
    expect(org.deletionScheduledAt!.getTime()).toBeGreaterThanOrEqual(before + 29 * 24 * 60 * 60 * 1000);
    expect(org.deletionScheduledAt!.getTime()).toBeLessThanOrEqual(before + 31 * 24 * 60 * 60 * 1000);
  });

  it('throws ORG_ALREADY_PENDING_DELETION if already pending deletion', () => {
    const org = Organization.create(makeOrgData({ status: 'pending_deletion', deletionScheduledAt: new Date() }));
    expectOrgError(() => org.scheduleDeletion(), 'ORG_ALREADY_PENDING_DELETION');
  });

  it('throws ORG_CANNOT_DELETE_SUSPENDED if organization is suspended', () => {
    const org = Organization.create(makeOrgData({ status: 'suspended' }));
    expectOrgError(() => org.scheduleDeletion(), 'ORG_CANNOT_DELETE_SUSPENDED');
  });

  it('cancelDeletion restores active status and clears deletion date', () => {
    const org = Organization.create(makeOrgData({ status: 'pending_deletion', deletionScheduledAt: new Date() }));
    org.cancelDeletion();
    expect(org.status).toBe('active');
    expect(org.deletionScheduledAt).toBeNull();
  });

  it('cancelDeletion throws ORG_NOT_PENDING_DELETION if not pending deletion', () => {
    const org = Organization.create(makeOrgData());
    expectOrgError(() => org.cancelDeletion(), 'ORG_NOT_PENDING_DELETION');
  });
});

describe('CUR-1: Base currency immutability', () => {
  it('assertBaseCurrencyMutable does not throw when no monetary records exist', () => {
    const org = Organization.create(makeOrgData());
    expect(() => org.assertBaseCurrencyMutable(false)).not.toThrow();
  });

  it('assertBaseCurrencyMutable throws BASE_CURRENCY_IMMUTABLE when monetary records exist', () => {
    const org = Organization.create(makeOrgData());
    expectOrgError(() => org.assertBaseCurrencyMutable(true), 'BASE_CURRENCY_IMMUTABLE');
  });
});

describe('Organization.toJSON()', () => {
  it('returns a copy of the organization data', () => {
    const data = makeOrgData();
    const org = Organization.create(data);
    const json = org.toJSON();
    expect(json.id).toBe(data.id);
    expect(json.name).toBe(data.name);
    expect(json.status).toBe('active');
  });
});
