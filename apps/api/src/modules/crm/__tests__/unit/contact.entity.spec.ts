import { describe, expect, it } from 'vitest';

import { Contact, CrmError, CRM_ERROR_CODE, type ContactData } from '../../domain/index.js';

function makeContactData(overrides: Partial<ContactData> = {}): ContactData {
  return {
    id: 'contact-1',
    organizationId: 'org-1',
    companyId: null,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: null,
    secondaryPhone: null,
    ownerUserId: null,
    preferredLocale: null,
    preferredCurrency: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

function expectCrmError(action: () => void, expectedCode: string): void {
  try {
    action();
    expect.fail('Expected CrmError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(CrmError);
    expect((error as CrmError).code).toBe(expectedCode);
  }
}

describe('CRM-1: a contact requires at least one of email or phone', () => {
  it('accepts a contact with an email and no phone', () => {
    const contact = Contact.create(makeContactData());
    expect(contact.email).toBe('ada@example.com');
    expect(contact.phone).toBeNull();
  });

  it('accepts a contact with a phone and no email', () => {
    const contact = Contact.create(makeContactData({ email: null, phone: '+1 555 0100' }));
    expect(contact.email).toBeNull();
    expect(contact.phone).toBe('+1 555 0100');
  });

  it('rejects a contact with neither email nor phone', () => {
    expectCrmError(
      () => Contact.create(makeContactData({ email: null, phone: null })),
      CRM_ERROR_CODE.CONTACT_REQUIRES_IDENTITY,
    );
  });

  it('re-validates CRM-1 on update when the last identity field is removed', () => {
    const contact = Contact.create(makeContactData({ phone: '+1 555 0100' }));
    expectCrmError(
      () => contact.update({ email: null, phone: null, updatedBy: 'user-2' }),
      CRM_ERROR_CODE.CONTACT_REQUIRES_IDENTITY,
    );
  });
});

describe('CRM-2: contact email is unique per organization', () => {
  it('rejects a duplicate email per organization', () => {
    const existing = Contact.create(makeContactData({ id: 'contact-0' }));
    const duplicate = Contact.create(makeContactData({ id: 'contact-1', email: 'ada@example.com' }));

    expectCrmError(
      () => duplicate.assertEmailUniqueIn(new Set([existing.email!])),
      CRM_ERROR_CODE.CONTACT_DUPLICATE_EMAIL,
    );
  });

  it('compares emails case-insensitively (citext column)', () => {
    const duplicate = Contact.create(makeContactData({ email: 'ADA@EXAMPLE.COM' }));
    expectCrmError(
      () => duplicate.assertEmailUniqueIn(new Set(['ada@example.com'])),
      CRM_ERROR_CODE.CONTACT_DUPLICATE_EMAIL,
    );
  });

  it('allows the same email in a different organization', () => {
    const duplicate = Contact.create(makeContactData({ email: 'ada@example.com' }));
    // Only the org's own emails are passed in — a different org's set is empty.
    expect(() => duplicate.assertEmailUniqueIn(new Set())).not.toThrow();
  });

  it('is a no-op for contacts without an email', () => {
    const contact = Contact.create(makeContactData({ email: null, phone: '+1 555 0100' }));
    expect(() => contact.assertEmailUniqueIn(new Set(['ada@example.com']))).not.toThrow();
  });
});

describe('Contact behaviour', () => {
  it('updates editable fields and stamps updatedBy', () => {
    const contact = Contact.create(makeContactData());
    contact.update({ firstName: 'Augusta', companyId: 'company-9', updatedBy: 'user-2' });
    expect(contact.firstName).toBe('Augusta');
    expect(contact.companyId).toBe('company-9');
    expect(contact.toJSON().updatedBy).toBe('user-2');
  });

  it('CRM-11: markDeleted sets deletedAt', () => {
    const contact = Contact.create(makeContactData());
    expect(contact.deletedAt).toBeNull();
    contact.markDeleted('user-2', new Date('2026-02-01T00:00:00Z'));
    expect(contact.deletedAt).toEqual(new Date('2026-02-01T00:00:00Z'));
  });

  it('toJSON returns a copy of the data', () => {
    const data = makeContactData();
    const contact = Contact.create(data);
    const json = contact.toJSON();
    expect(json.organizationId).toBe('org-1');
    expect(json.firstName).toBe('Ada');
  });
});
