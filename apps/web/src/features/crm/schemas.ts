import { z } from 'zod';

/**
 * Phone numbers: optional leading `+`, then 5–30 characters of digits and
 * common separators. Matches the API boundary validation (crm.dto.ts).
 */
const phoneField = z
  .string()
  .trim()
  .regex(/^\+?[\d\s().-]{5,30}$/, 'Invalid phone number')
  .or(z.literal(''));

export const contactFormSchema = z
  .object({
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    email: z.string().trim().email().or(z.literal('')),
    phone: phoneField,
    secondaryPhone: phoneField,
    companyId: z.string().trim(),
    preferredLocale: z.string().trim(),
    preferredCurrency: z.string().trim(),
  })
  .refine((value) => value.email !== '' || value.phone !== '', { path: ['email'] });

export const companyFormSchema = z.object({
  name: z.string().trim().min(1),
  domain: z.string().trim(),
  industry: z.string().trim(),
  addressStreet: z.string().trim(),
  addressCity: z.string().trim(),
  addressState: z.string().trim(),
  addressPostalCode: z.string().trim(),
  addressCountry: z.string().trim(),
});

export const dealFormSchema = z
  .object({
    title: z.string().trim().min(1),
    contactId: z.string().uuid().or(z.literal('')),
    companyId: z.string().uuid().or(z.literal('')),
    amountMinor: z.string().regex(/^\d+$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .refine((value) => value.contactId !== '' || value.companyId !== '', { path: ['contactId'] });

export const activityFormSchema = z.object({
  type: z.enum(['call', 'meeting', 'task', 'email']),
  subject: z.string().trim().min(1),
  dueAt: z.string(),
});

export type ContactFormValues = z.infer<typeof contactFormSchema>;
export type CompanyFormValues = z.infer<typeof companyFormSchema>;
export type DealFormValues = z.infer<typeof dealFormSchema>;
export type ActivityFormValues = z.infer<typeof activityFormSchema>;
