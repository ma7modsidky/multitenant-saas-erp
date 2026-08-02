import { z } from 'zod';

/**
 * Schema for inviting a user.
 */
export const inviteUserSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120, 'Name must be 120 characters or fewer'),
    email: z.string().email('Invalid email address').max(255),
    roleId: z.string().uuid('Role ID must be a valid UUID'),
  })
  .strict();

export type InviteUserDto = z.infer<typeof inviteUserSchema>;

/**
 * Schema for updating a member's role.
 */
export const updateMemberRoleSchema = z
  .object({
    roleId: z.string().uuid('Role ID must be a valid UUID'),
  })
  .strict();

export type UpdateMemberRoleDto = z.infer<typeof updateMemberRoleSchema>;

/**
 * Schema for switching organization.
 */
export const switchOrgSchema = z
  .object({
    organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  })
  .strict();

export type SwitchOrgDto = z.infer<typeof switchOrgSchema>;

/**
 * Member response DTO.
 */
export interface MemberResponse {
  id: string;
  userId: string;
  email: string;
  name: string;
  roleId: string;
  status: string;
  joinedAt: string;
}

/**
 * Invitation response DTO.
 */
export interface InvitationResponse {
  id: string;
  /** Invitee display name (nullable for pre-0012 invitations). */
  name: string | null;
  email: string;
  roleId: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}
