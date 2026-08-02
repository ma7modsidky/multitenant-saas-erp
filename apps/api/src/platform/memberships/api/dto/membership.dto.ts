import { createZodDto } from 'nestjs-zod';
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

/**
 * Request DTO for inviting a user.
 */
export class InviteUserDto extends createZodDto(inviteUserSchema) {}

/**
 * Schema for updating a member's role.
 */
export const updateMemberRoleSchema = z
  .object({
    roleId: z.string().uuid('Role ID must be a valid UUID'),
  })
  .strict();

/**
 * Request DTO for updating a member's role.
 */
export class UpdateMemberRoleDto extends createZodDto(updateMemberRoleSchema) {}

/**
 * Schema for switching organization.
 */
export const switchOrgSchema = z
  .object({
    organizationId: z.string().uuid('Organization ID must be a valid UUID'),
  })
  .strict();

/**
 * Request DTO for switching organization.
 */
export class SwitchOrgDto extends createZodDto(switchOrgSchema) {}

/**
 * Member response payload.
 */
export const memberResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  roleId: z.string(),
  status: z.string(),
  joinedAt: z.string(),
});

/**
 * Member response DTO.
 */
export class MemberResponse extends createZodDto(memberResponseSchema) {}

/**
 * Invitation response payload.
 */
export const invitationResponseSchema = z.object({
  id: z.string(),
  /** Invitee display name (nullable for pre-0012 invitations). */
  name: z.string().nullable(),
  email: z.string(),
  roleId: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

/**
 * Invitation response DTO.
 */
export class InvitationResponse extends createZodDto(invitationResponseSchema) {}

// ─── Response envelopes (match the `{ data }` wire format) ────────────────

/** `{ data: Array<{...}> }` — my organizations (organization switcher). */
export const myOrganizationsEnvelopeSchema = z.object({
  data: z.array(
    z.object({
      organizationId: z.string(),
      organizationName: z.string(),
      organizationSlug: z.string(),
      roleId: z.string(),
      status: z.string(),
      organizationStatus: z.string(),
      joinedAt: z.string(),
      current: z.boolean(),
    }),
  ),
});

export class MyOrganizationsEnvelopeResponse extends createZodDto(myOrganizationsEnvelopeSchema) {}

/** `{ data: MemberResponse[] }` — list members. */
export const membersEnvelopeSchema = z.object({
  data: z.array(memberResponseSchema),
});

export class MembersEnvelopeResponse extends createZodDto(membersEnvelopeSchema) {}

/** `{ data: InvitationResponse[] }` — list invitations. */
export const invitationsEnvelopeSchema = z.object({
  data: z.array(invitationResponseSchema),
});

export class InvitationsEnvelopeResponse extends createZodDto(invitationsEnvelopeSchema) {}

/** `{ data: { invitationId } }` — invite. */
export const invitationCreatedEnvelopeSchema = z.object({
  data: z.object({ invitationId: z.string() }),
});

export class InvitationCreatedEnvelopeResponse extends createZodDto(invitationCreatedEnvelopeSchema) {}

/** `{ data: { accessToken; refreshToken } }` — switch org. */
export const switchOrgEnvelopeSchema = z.object({
  data: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
  }),
});

export class SwitchOrgEnvelopeResponse extends createZodDto(switchOrgEnvelopeSchema) {}

/** `{ data: { message } }` — accept / revoke / update role / remove member. */
export const membershipMessageEnvelopeSchema = z.object({
  data: z.object({ message: z.string() }),
});

export class MembershipMessageEnvelopeResponse extends createZodDto(membershipMessageEnvelopeSchema) {}
