import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const enableModuleSchema = z
  .object({
    moduleKey: z.string().min(1).max(64),
  })
  .strict();

/**
 * Request DTO for enabling a module.
 */
export class EnableModuleDto extends createZodDto(enableModuleSchema) {}

export const disableModuleSchema = z
  .object({
    moduleKey: z.string().min(1).max(64),
  })
  .strict();

/**
 * Request DTO for disabling a module.
 */
export class DisableModuleDto extends createZodDto(disableModuleSchema) {}

/**
 * Module catalog response payload.
 */
export const moduleCatalogResponseSchema = z.object({
  key: z.string(),
  nameKey: z.string(),
  descriptionKey: z.string().nullable(),
  icon: z.string().nullable(),
  dependsOn: z.array(z.string()),
  trialDays: z.number(),
});

/**
 * Module catalog response DTO.
 */
export class ModuleCatalogResponse extends createZodDto(moduleCatalogResponseSchema) {}

/**
 * Navigation response payload.
 */
export const navigationResponseSchema = z.object({
  moduleKey: z.string(),
  labelKey: z.string(),
  icon: z.string().optional(),
  items: z.array(
    z.object({
      labelKey: z.string(),
      href: z.string(),
      icon: z.string().optional(),
      children: z
        .array(
          z.object({
            labelKey: z.string(),
            href: z.string(),
            icon: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
});

/**
 * Navigation response DTO.
 */
export class NavigationResponse extends createZodDto(navigationResponseSchema) {}

/**
 * Dashboard widget response payload.
 */
export const dashboardWidgetResponseSchema = z.object({
  id: z.string(),
  titleKey: z.string(),
  width: z.number(),
  height: z.number(),
  icon: z.string().optional(),
});

/**
 * Dashboard widget response DTO.
 */
export class DashboardWidgetResponse extends createZodDto(dashboardWidgetResponseSchema) {}

/**
 * Dashboard widgets response payload.
 */
export const dashboardWidgetsResponseSchema = z.object({
  moduleKey: z.string(),
  labelKey: z.string(),
  widgets: z.array(dashboardWidgetResponseSchema),
});

/**
 * Dashboard widgets response DTO.
 */
export class DashboardWidgetsResponse extends createZodDto(dashboardWidgetsResponseSchema) {}

// ─── Response envelopes (match the `{ data }` wire format) ────────────────

/** `{ data: ModuleCatalogResponse[] }` — module catalog. */
export const moduleCatalogEnvelopeSchema = z.object({
  data: z.array(moduleCatalogResponseSchema),
});

export class ModuleCatalogEnvelopeResponse extends createZodDto(moduleCatalogEnvelopeSchema) {}

/** `{ data: NavigationResponse[] }` — navigation. */
export const navigationEnvelopeSchema = z.object({
  data: z.array(navigationResponseSchema),
});

export class NavigationEnvelopeResponse extends createZodDto(navigationEnvelopeSchema) {}

/** `{ data: DashboardWidgetsResponse[] }` — dashboard widgets. */
export const dashboardWidgetsEnvelopeSchema = z.object({
  data: z.array(dashboardWidgetsResponseSchema),
});

export class DashboardWidgetsEnvelopeResponse extends createZodDto(dashboardWidgetsEnvelopeSchema) {}

/** `{ data: { message } }` — enable / disable module. */
export const moduleRegistryMessageEnvelopeSchema = z.object({
  data: z.object({ message: z.string() }),
});

export class ModuleRegistryMessageEnvelopeResponse extends createZodDto(moduleRegistryMessageEnvelopeSchema) {}
