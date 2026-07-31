/** Role not found. */
export const ROLE_NOT_FOUND = 'ROLE_NOT_FOUND';

/** System roles cannot be deleted or renamed. */
export const SYSTEM_ROLE_IMMUTABLE = 'SYSTEM_ROLE_IMMUTABLE';

/** Cannot delete the last OWNER role. */
export const LAST_OWNER_ROLE = 'LAST_OWNER_ROLE';

/** Cannot assign a role that includes permissions the assigner does not have. */
export const CANNOT_GRANT_UNOWNED_PERMISSION = 'CANNOT_GRANT_UNOWNED_PERMISSION';

/** Custom roles may not include platform-admin permissions (AUTHZ-4). */
export const CUSTOM_ROLE_PLATFORM_PERMISSION_DENIED = 'CUSTOM_ROLE_PLATFORM_PERMISSION_DENIED';

/** Ownership transfer target not found or not an active member. */
export const TRANSFER_TARGET_NOT_FOUND = 'TRANSFER_TARGET_NOT_FOUND';

/** Cannot transfer ownership to self. */
export const CANNOT_TRANSFER_TO_SELF = 'CANNOT_TRANSFER_TO_SELF';

/** Must nominate a target before stepping down. */
export const NOMINATION_REQUIRED = 'NOMINATION_REQUIRED';

/** Permission not found in the catalog. */
export const PERMISSION_NOT_FOUND = 'PERMISSION_NOT_FOUND';

/** Role key already exists in this organization. */
export const ROLE_KEY_EXISTS = 'ROLE_KEY_EXISTS';
