import { z } from 'zod';

export const createRoleSchema = z.object({
  key: z.string().min(1).max(50).regex(/^[a-z_]+$/, 'Key must be lowercase with underscores'),
  nameI18n: z.record(z.string(), z.string()).optional().default({}),
  description: z.string().max(255).optional(),
  permissionKeys: z.array(z.string()).optional(),
}).strict();

export type CreateRoleDto = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  nameI18n: z.record(z.string(), z.string()).optional(),
  description: z.string().max(255).nullable().optional(),
  permissionKeys: z.array(z.string()).optional(),
}).strict();

export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;

export const assignRoleSchema = z.object({
  roleId: z.string().uuid(),
}).strict();

export type AssignRoleDto = z.infer<typeof assignRoleSchema>;

export const transferOwnershipSchema = z.object({
  targetUserId: z.string().uuid(),
}).strict();

export type TransferOwnershipDto = z.infer<typeof transferOwnershipSchema>;

export interface RoleResponse {
  id: string;
  key: string;
  nameI18n: Record<string, string>;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  memberCount: number;
}

export interface RoleMatrixResponse {
  systemRoles: Array<{ key: string; permissions: string[] }>;
  customRoles: Array<{
    id: string;
    key: string;
    nameI18n: Record<string, string>;
    description: string | null;
    permissions: string[];
  }>;
  platformPermissions: string[];
  permissionCatalog: string[];
}
