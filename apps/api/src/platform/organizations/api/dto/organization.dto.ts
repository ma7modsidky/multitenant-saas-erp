import { createZodDto } from 'nestjs-zod';
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

/**
 * Request DTO for creating an organization (also used for OpenAPI reflection).
 */
export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}

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

/**
 * Request DTO for updating an organization.
 */
export class UpdateOrganizationDto extends createZodDto(updateOrganizationSchema) {}

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
    numberPreferences: z.record(z.string(), z.unknown()).optional(),
    datePreferences: z.record(z.string(), z.unknown()).optional(),
    receiptFooter: z.string().max(500).nullable().optional(),
    sellerTaxId: z.string().max(50).nullable().optional(),
    taxEnabled: z.boolean().optional(),
  })
  .strict();

/**
 * Request DTO for updating organization settings.
 */
export class UpdateOrganizationSettingsDto extends createZodDto(updateOrganizationSettingsSchema) {}

/**
 * Organization response payload (camelCase for API consumers).
 */
export const organizationResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  countryCode: z.string(),
  timezone: z.string(),
  baseCurrency: z.string(),
  defaultLocale: z.string(),
  status: z.string(),
  deletionScheduledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Organization response DTO (used for typing and OpenAPI reflection).
 */
export class OrganizationResponse extends createZodDto(organizationResponseSchema) {}

/**
 * Organization settings response payload.
 */
export const organizationSettingsResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  locale: z.string(),
  timezone: z.string(),
  baseCurrency: z.string(),
  numberPreferences: z.record(z.string(), z.unknown()),
  datePreferences: z.record(z.string(), z.unknown()),
  receiptFooter: z.string().nullable(),
  sellerTaxId: z.string().nullable(),
  taxEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Organization settings response DTO.
 */
export class OrganizationSettingsResponse extends createZodDto(organizationSettingsResponseSchema) {}

// ─── Response envelopes (match the `{ data }` wire format) ────────────────

/** `{ data: OrganizationResponse }` — create / update / cancel-deletion. */
export const organizationEnvelopeSchema = z.object({
  data: organizationResponseSchema,
});

export class OrganizationEnvelopeResponse extends createZodDto(organizationEnvelopeSchema) {}

/** `{ data: OrganizationResponse; settings: OrganizationSettingsResponse | null }` — get by id / me. */
export const organizationDetailEnvelopeSchema = z.object({
  data: organizationResponseSchema,
  settings: organizationSettingsResponseSchema.nullable(),
});

export class OrganizationDetailResponse extends createZodDto(organizationDetailEnvelopeSchema) {}

/** `{ data: { deletionScheduledAt; message } }` — soft-delete. */
export const organizationDeleteEnvelopeSchema = z.object({
  data: z.object({
    deletionScheduledAt: z.string(),
    message: z.string(),
  }),
});

export class OrganizationDeleteResponse extends createZodDto(organizationDeleteEnvelopeSchema) {}

/** `{ data: OrganizationSettingsResponse | null }` — get settings. */
export const settingsEnvelopeSchema = z.object({
  data: organizationSettingsResponseSchema.nullable(),
});

export class SettingsEnvelopeResponse extends createZodDto(settingsEnvelopeSchema) {}

/** `{ data: OrganizationSettingsResponse }` — update settings. */
export const settingsUpdateEnvelopeSchema = z.object({
  data: organizationSettingsResponseSchema,
});

export class SettingsUpdateEnvelopeResponse extends createZodDto(settingsUpdateEnvelopeSchema) {}

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
  sellerTaxId: string | null;
  taxEnabled: boolean;
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
    sellerTaxId: settings.sellerTaxId,
    taxEnabled: settings.taxEnabled,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}
