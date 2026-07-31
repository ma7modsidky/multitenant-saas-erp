/**
 * Organization module domain error codes.
 *
 * These are stable, machine-readable codes returned to the client.
 * The frontend renders localized messages based on these codes.
 *
 * @see CODING_STANDARDS.md §7 — Error model
 */

/** Slug is already taken by another organization. */
export const ORG_SLUG_TAKEN = 'ORG_SLUG_TAKEN';

/** Organization not found by the given identifier. */
export const ORG_NOT_FOUND = 'ORG_NOT_FOUND';

/** Base currency cannot be changed after monetary records exist (CUR-1). */
export const BASE_CURRENCY_IMMUTABLE = 'BASE_CURRENCY_IMMUTABLE';

/** Organization is already pending deletion. */
export const ORG_ALREADY_PENDING_DELETION = 'ORG_ALREADY_PENDING_DELETION';

/** Cannot delete a suspended organization. */
export const ORG_CANNOT_DELETE_SUSPENDED = 'ORG_CANNOT_DELETE_SUSPENDED';

/** Organization is not pending deletion. */
export const ORG_NOT_PENDING_DELETION = 'ORG_NOT_PENDING_DELETION';

/** Organization not found. */
export const ORG_SETTINGS_NOT_FOUND = 'ORG_SETTINGS_NOT_FOUND';
