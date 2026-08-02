import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Zod schema for user signup.
 */
export const signupSchema = z
  .object({
    email: z.string().email('Invalid email address').max(255, 'Email must be at most 255 characters'),
    password: z
      .string()
      .min(12, 'Password must be at least 12 characters (AUTH-2)')
      .max(128, 'Password must be at most 128 characters'),
    name: z.string().min(1, 'Name is required').max(100, 'Name must be at most 100 characters'),
    preferredLocale: z.string().min(2).max(10).optional(),
  })
  .strict();

/**
 * Request DTO for signup.
 */
export class SignupDto extends createZodDto(signupSchema) {}

/**
 * Zod schema for login.
 */
export const loginSchema = z
  .object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
    device: z.string().max(200).optional(),
  })
  .strict();

/**
 * Request DTO for login.
 */
export class LoginDto extends createZodDto(loginSchema) {}

/**
 * Zod schema for token refresh.
 */
export const refreshTokenSchema = z
  .object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  })
  .strict();

/**
 * Request DTO for token refresh.
 */
export class RefreshTokenDto extends createZodDto(refreshTokenSchema) {}

/**
 * Zod schema for requesting a password reset.
 */
export const requestPasswordResetSchema = z
  .object({
    email: z.string().email('Invalid email address'),
  })
  .strict();

/**
 * Request DTO for requesting a password reset.
 */
export class RequestPasswordResetDto extends createZodDto(requestPasswordResetSchema) {}

/**
 * Zod schema for completing a password reset.
 */
export const completePasswordResetSchema = z
  .object({
    email: z.string().email('Invalid email address'),
    resetToken: z.string().min(1, 'Reset token is required'),
    newPassword: z
      .string()
      .min(12, 'Password must be at least 12 characters (AUTH-2)')
      .max(128, 'Password must be at most 128 characters'),
  })
  .strict();

/**
 * Request DTO for completing a password reset.
 */
export class CompletePasswordResetDto extends createZodDto(completePasswordResetSchema) {}

/**
 * Zod schema for changing password (authenticated).
 */
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(12, 'Password must be at least 12 characters (AUTH-2)')
      .max(128, 'Password must be at most 128 characters'),
  })
  .strict();

/**
 * Request DTO for changing password.
 */
export class PasswordChangeDto extends createZodDto(passwordChangeSchema) {}

/**
 * Auth response payload.
 */
export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    preferredLocale: z.string().nullable(),
    emailVerified: z.boolean(),
  }),
});

/**
 * Auth response DTO.
 */
export class AuthResponse extends createZodDto(authResponseSchema) {}

// ─── Response envelopes (match the `{ data }` wire format) ────────────────

/** `{ data: { message } }` — signup / password-reset flow. */
export const authMessageEnvelopeSchema = z.object({
  data: z.object({ message: z.string() }),
});

export class AuthMessageEnvelopeResponse extends createZodDto(authMessageEnvelopeSchema) {}

/** `{ data: AuthResponse }` — login. */
export const authEnvelopeSchema = z.object({
  data: authResponseSchema,
});

export class AuthEnvelopeResponse extends createZodDto(authEnvelopeSchema) {}

/** `{ data: { accessToken; refreshToken } }` — refresh. */
export const tokenPairEnvelopeSchema = z.object({
  data: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
  }),
});

export class TokenPairEnvelopeResponse extends createZodDto(tokenPairEnvelopeSchema) {}

/**
 * Build an auth response from a user entity.
 */
export function buildAuthResponse(
  accessToken: string,
  refreshToken: string,
  user: { id: string; email: string; name: string; preferredLocale: string | null; isEmailVerified: boolean },
): AuthResponse {
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
