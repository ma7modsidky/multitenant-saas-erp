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

export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

/**
 * Session response DTO.
 */
export interface SessionResponse {
  id: string;
  device: string | undefined;
  ip: string | undefined;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/**
 * User profile response DTO.
 */
export interface UserProfileResponse {
  id: string;
  email: string;
  name: string;
  preferredLocale: string | null;
  emailVerified: boolean;
  createdAt: string;
}
