import { z } from 'zod';

/**
 * Zod schema for creating an organization.
 */
export const createOrganizationSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Organization name is required')
      .max(200, 'Organization name must be at most 200 characters'),
    slug: z
      .string()
      .min(2, 'Slug must be at least 2 characters')
      .max(100, 'Slug must be at most 100 characters')
      .regex(
        /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
        'Slug must start and end with a letter/number and contain only lowercase letters, numbers, and hyphens',
      ),
    countryCode: z
      .string()
      .length(2, 'Country code must be 2 characters (ISO 3166-1 alpha-2)')
      .regex(/^[A-Z]{2}$/, 'Country code must be uppercase (e.g., US, GB, AE)'),
    timezone: z.string().min(1, 'Timezone is required').max(50).default('UTC'),
    baseCurrency: z
      .string()
      .length(3, 'Currency must be a 3-letter ISO 4217 code')
      .regex(/^[A-Z]{3}$/, 'Currency must be uppercase (e.g., USD, EUR, AED)'),
    defaultLocale: z.string().min(2).max(10).default('en'),
  })
  .strict();

export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;

/**
 * Zod schema for updating an organization.
 */
export const updateOrganizationSchema = z
  .object({
    name: z.string().min(1, 'Organization name is required').max(200).optional(),
    countryCode: z
      .string()
      .length(2)
      .regex(/^[A-Z]{2}$/)
      .optional(),
    timezone: z.string().min(1).max(50).optional(),
    baseCurrency: z
      .string()
      .length(3)
      .regex(/^[A-Z]{3}$/)
      .optional(),
    defaultLocale: z.string().min(2).max(10).optional(),
    hasMonetaryRecords: z.boolean().optional(),
  })
  .strict();

export type UpdateOrganizationDto = z.infer<typeof updateOrganizationSchema>;

/**
 * Zod schema for updating organization settings.
 */
export const updateOrganizationSettingsSchema = z
  .object({
    locale: z.string().min(2).max(10).optional(),
    timezone: z.string().min(1).max(50).optional(),
    baseCurrency: z
      .string()
      .length(3)
      .regex(/^[A-Z]{3}$/)
      .optional(),
    numberPreferences: z.record(z.unknown()).optional(),
    datePreferences: z.record(z.unknown()).optional(),
    receiptFooter: z.string().max(500).nullable().optional(),
  })
  .strict();

export type UpdateOrganizationSettingsDto = z.infer<typeof updateOrganizationSettingsSchema>;

/**
 * Organization response DTO (camelCase for API consumers).
 */
export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  countryCode: string;
  timezone: string;
  baseCurrency: string;
  defaultLocale: string;
  status: string;
  deletionScheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Organization settings response DTO.
 */
export interface OrganizationSettingsResponse {
  id: string;
  organizationId: string;
  locale: string;
  timezone: string;
  baseCurrency: string;
  numberPreferences: Record<string, unknown>;
  datePreferences: Record<string, unknown>;
  receiptFooter: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Map Organization domain entity to API response.
 */
export function organizationToResponse(org: {
  id: string;
  name: string;
  slug: string;
  countryCode: string;
  timezone: string;
  baseCurrency: string;
  defaultLocale: string;
  status: string;
  deletionScheduledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): OrganizationResponse {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    countryCode: org.countryCode,
    timezone: org.timezone,
    baseCurrency: org.baseCurrency,
    defaultLocale: org.defaultLocale,
    status: org.status,
    deletionScheduledAt: org.deletionScheduledAt?.toISOString() ?? null,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  };
}

/**
 * Map OrganizationSettings domain entity to API response.
 */
export function settingsToResponse(settings: {
  id: string;
  organizationId: string;
  locale: string;
  timezone: string;
  baseCurrency: string;
  numberPreferences: Record<string, unknown>;
  datePreferences: Record<string, unknown>;
  receiptFooter: string | null;
  createdAt: Date;
  updatedAt: Date;
}): OrganizationSettingsResponse {
  return {
    id: settings.id,
    organizationId: settings.organizationId,
    locale: settings.locale,
    timezone: settings.timezone,
    baseCurrency: settings.baseCurrency,
    numberPreferences: settings.numberPreferences,
    datePreferences: settings.datePreferences,
    receiptFooter: settings.receiptFooter,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}
