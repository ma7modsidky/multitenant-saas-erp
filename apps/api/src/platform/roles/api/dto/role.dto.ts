import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createRoleSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-z_]+$/, 'Key must be lowercase with underscores'),
    nameI18n: z.record(z.string(), z.string()).optional().default({}),
    description: z.string().max(255).optional(),
    permissionKeys: z.array(z.string()).optional(),
  })
  .strict();

/**
 * Request DTO for creating a role.
 */
export class CreateRoleDto extends createZodDto(createRoleSchema) {}

export const updateRoleSchema = z
  .object({
    nameI18n: z.record(z.string(), z.string()).optional(),
    description: z.string().max(255).nullable().optional(),
    permissionKeys: z.array(z.string()).optional(),
  })
  .strict();

/**
 * Request DTO for updating a role.
 */
export class UpdateRoleDto extends createZodDto(updateRoleSchema) {}

export const assignRoleSchema = z
  .object({
    roleId: z.string().uuid(),
  })
  .strict();

/**
 * Request DTO for assigning a role.
 */
export class AssignRoleDto extends createZodDto(assignRoleSchema) {}

export const transferOwnershipSchema = z
  .object({
    targetUserId: z.string().uuid(),
  })
  .strict();

/**
 * Request DTO for transferring ownership.
 */
export class TransferOwnershipDto extends createZodDto(transferOwnershipSchema) {}

/**
 * Role response payload.
 */
export const roleResponseSchema = z.object({
  id: z.string(),
  key: z.string(),
  nameI18n: z.record(z.string(), z.string()),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
  memberCount: z.number(),
});

/**
 * Role response DTO.
 */
export class RoleResponse extends createZodDto(roleResponseSchema) {}

/**
 * Role matrix response payload.
 */
export const roleMatrixResponseSchema = z.object({
  systemRoles: z.array(
    z.object({
      key: z.string(),
      permissions: z.array(z.string()),
    }),
  ),
  customRoles: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      nameI18n: z.record(z.string(), z.string()),
      description: z.string().nullable(),
      permissions: z.array(z.string()),
    }),
  ),
  platformPermissions: z.array(z.string()),
  permissionCatalog: z.array(z.string()),
});

/**
 * Role matrix response DTO.
 */
export class RoleMatrixResponse extends createZodDto(roleMatrixResponseSchema) {}

// ─── Response envelopes (match the `{ data }` wire format) ────────────────

/** `{ data: RoleResponse[] }` — list roles. */
export const rolesEnvelopeSchema = z.object({
  data: z.array(roleResponseSchema),
});

export class RolesEnvelopeResponse extends createZodDto(rolesEnvelopeSchema) {}

/** `{ data: RoleMatrixResponse }` — role matrix. */
export const roleMatrixEnvelopeSchema = z.object({
  data: roleMatrixResponseSchema,
});

export class RoleMatrixEnvelopeResponse extends createZodDto(roleMatrixEnvelopeSchema) {}

/** `{ data: { id } }` — create role. */
export const roleCreatedEnvelopeSchema = z.object({
  data: z.object({ id: z.string() }),
});

export class RoleCreatedEnvelopeResponse extends createZodDto(roleCreatedEnvelopeSchema) {}

/** `{ data: { message } }` — update / delete / assign / transfer. */
export const roleMessageEnvelopeSchema = z.object({
  data: z.object({ message: z.string() }),
});

export class RoleMessageEnvelopeResponse extends createZodDto(roleMessageEnvelopeSchema) {}
