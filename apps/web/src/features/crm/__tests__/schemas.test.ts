import { describe, expect, it } from 'vitest';

import { contactFormSchema, dealFormSchema } from '../schemas';

function validContact(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '',
    secondaryPhone: '',
    companyId: '',
    preferredLocale: '',
    preferredCurrency: '',
    ...overrides,
  };
}

describe('CRM frontend schemas', () => {
  it('CRM-1: rejects a contact without email or phone', () => {
    expect(contactFormSchema.safeParse(validContact({ email: '', phone: '' })).success).toBe(false);
  });

  it('accepts a contact with only a phone number', () => {
    expect(contactFormSchema.safeParse(validContact({ email: '', phone: '+1 202 555 0147' })).success).toBe(true);
  });

  it('rejects a phone number containing non-phone characters', () => {
    expect(contactFormSchema.safeParse(validContact({ phone: 'call me please' })).success).toBe(false);
    expect(contactFormSchema.safeParse(validContact({ secondaryPhone: '123abc' })).success).toBe(false);
  });

  it('accepts formatted phone numbers with separators', () => {
    expect(contactFormSchema.safeParse(validContact({ phone: '+20 (2) 555-0147' })).success).toBe(true);
  });

  it('rejects a phone number shorter than 5 characters', () => {
    expect(contactFormSchema.safeParse(validContact({ phone: '1234' })).success).toBe(false);
  });

  it('accepts secondary phone and preference fields', () => {
    expect(
      contactFormSchema.safeParse(
        validContact({ secondaryPhone: '+971 50 555 0147', preferredLocale: 'ar', preferredCurrency: 'AED' }),
      ).success,
    ).toBe(true);
  });

  it('CRM-10: rejects a deal without contact or company', () => {
    expect(
      dealFormSchema.safeParse({ title: 'Deal', contactId: '', companyId: '', amountMinor: '100', currency: 'USD' })
        .success,
    ).toBe(false);
  });
});
