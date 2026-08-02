import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Zod schema for updating user profile.
 */
export const updateProfileSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    preferredLocale: z.string().min(2).max(10).nullable().optional(),
  })
  .strict();

/**
 * Request DTO for updating the user profile.
 */
export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}

/**
 * Session response payload.
 */
export const sessionResponseSchema = z.object({
  id: z.string(),
  device: z.string().optional(),
  ip: z.string().optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
  current: z.boolean(),
});

/**
 * Session response DTO.
 */
export class SessionResponse extends createZodDto(sessionResponseSchema) {}

/**
 * User profile response payload.
 */
export const userProfileResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  preferredLocale: z.string().nullable(),
  emailVerified: z.boolean(),
  createdAt: z.string(),
});

/**
 * User profile response DTO.
 */
export class UserProfileResponse extends createZodDto(userProfileResponseSchema) {}

// ─── Response envelopes (match the `{ data }` wire format) ────────────────

/** `{ data: { message } }` — change password / revoke session. */
export const userMessageEnvelopeSchema = z.object({
  data: z.object({ message: z.string() }),
});

export class UserMessageEnvelopeResponse extends createZodDto(userMessageEnvelopeSchema) {}

/** `{ data: UserProfileResponse }` — get / update profile. */
export const profileEnvelopeSchema = z.object({
  data: userProfileResponseSchema,
});

export class ProfileEnvelopeResponse extends createZodDto(profileEnvelopeSchema) {}

/** `{ data: SessionResponse[] }` — list sessions. */
export const sessionsEnvelopeSchema = z.object({
  data: z.array(sessionResponseSchema),
});

export class SessionsEnvelopeResponse extends createZodDto(sessionsEnvelopeSchema) {}
