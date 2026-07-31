import { z } from 'zod';

/**
 * Zod schema for user signup.
 */
export const signupSchema = z.object({
  email: z
    .string()
    .email('Invalid email address')
    .max(255, 'Email must be at most 255 characters'),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters (AUTH-2)')
    .max(128, 'Password must be at most 128 characters'),
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters'),
  preferredLocale: z
    .string()
    .min(2)
    .max(10)
    .optional(),
}).strict();

export type SignupDto = z.infer<typeof signupSchema>;

/**
 * Zod schema for login.
 */
export const loginSchema = z.object({
  email: z
    .string()
    .email('Invalid email address'),
  password: z
    .string()
    .min(1, 'Password is required'),
  device: z
    .string()
    .max(200)
    .optional(),
}).strict();

export type LoginDto = z.infer<typeof loginSchema>;

/**
 * Zod schema for token refresh.
 */
export const refreshTokenSchema = z.object({
  refreshToken: z
    .string()
    .min(1, 'Refresh token is required'),
}).strict();

export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;

/**
 * Zod schema for requesting a password reset.
 */
export const requestPasswordResetSchema = z.object({
  email: z
    .string()
    .email('Invalid email address'),
}).strict();

export type RequestPasswordResetDto = z.infer<typeof requestPasswordResetSchema>;

/**
 * Zod schema for completing a password reset.
 */
export const completePasswordResetSchema = z.object({
  email: z
    .string()
    .email('Invalid email address'),
  resetToken: z
    .string()
    .min(1, 'Reset token is required'),
  newPassword: z
    .string()
    .min(12, 'Password must be at least 12 characters (AUTH-2)')
    .max(128, 'Password must be at most 128 characters'),
}).strict();

export type CompletePasswordResetDto = z.infer<typeof completePasswordResetSchema>;

/**
 * Zod schema for changing password (authenticated).
 */
export const passwordChangeSchema = z.object({
  currentPassword: z
    .string()
    .min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(12, 'Password must be at least 12 characters (AUTH-2)')
    .max(128, 'Password must be at most 128 characters'),
}).strict();

export type PasswordChangeDto = z.infer<typeof passwordChangeSchema>;

/**
 * Auth response DTO.
 */
export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    preferredLocale: string | null;
    emailVerified: boolean;
  };
}

/**
 * Build an auth response from a user entity.
 */
export function buildAuthResponse(accessToken: string, refreshToken: string, user: { id: string; email: string; name: string; preferredLocale: string | null; isEmailVerified: boolean }): AuthResponse {
  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      preferredLocale: user.preferredLocale,
      emailVerified: user.isEmailVerified,
    },
  };
}
