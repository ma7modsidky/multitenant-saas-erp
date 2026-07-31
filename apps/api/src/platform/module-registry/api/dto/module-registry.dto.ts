import { z } from 'zod';

export const enableModuleSchema = z.object({
  moduleKey: z.string().min(1).max(64),
}).strict();

export type EnableModuleDto = z.infer<typeof enableModuleSchema>;

export const disableModuleSchema = z.object({
  moduleKey: z.string().min(1).max(64),
}).strict();

export type DisableModuleDto = z.infer<typeof disableModuleSchema>;

export interface ModuleCatalogResponse {
  key: string;
  nameKey: string;
  descriptionKey: string | null;
  icon: string | null;
  dependsOn: string[];
  trialDays: number;
}

export interface NavigationResponse {
  moduleKey: string;
  labelKey: string;
  icon?: string;
  items: Array<{
    labelKey: string;
    href: string;
    icon?: string;
    children?: Array<{ labelKey: string; href: string; icon?: string }>;
  }>;
}
