/**
 * User module domain error codes.
 *
 * These are stable, machine-readable codes returned to the client.
 * The frontend renders localized messages based on these codes.
 *
 * @see CODING_STANDARDS.md §7 — Error model
 */

/** Email already exists in the system. */
export const USER_EMAIL_TAKEN = 'USER_EMAIL_TAKEN';

/** User not found. */
export const USER_NOT_FOUND = 'USER_NOT_FOUND';

/** Invalid credentials (AUTH-8 — always generic). */
export const AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS';

/** Account is temporarily locked due to too many failures (AUTH-7). */
export const AUTH_ACCOUNT_LOCKED = 'AUTH_ACCOUNT_LOCKED';

/** Email not yet verified (AUTH-3). */
export const AUTH_EMAIL_NOT_VERIFIED = 'AUTH_EMAIL_NOT_VERIFIED';

/** Invalid or expired password reset token (AUTH-9). */
export const AUTH_INVALID_RESET_TOKEN = 'AUTH_INVALID_RESET_TOKEN';

/** Refresh token is invalid (AUTH-4). */
export const AUTH_INVALID_REFRESH_TOKEN = 'AUTH_INVALID_REFRESH_TOKEN';

/** Session has been revoked due to token reuse (AUTH-4). */
export const AUTH_SESSION_REVOKED = 'AUTH_SESSION_REVOKED';

/** Refresh token has expired. */
export const AUTH_EXPIRED_REFRESH_TOKEN = 'AUTH_EXPIRED_REFRESH_TOKEN';
