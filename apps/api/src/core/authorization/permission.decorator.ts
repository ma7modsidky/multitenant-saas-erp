import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for required permissions on a route handler.
 */
export const REQUIRED_PERMISSIONS_KEY = 'authorization:requiredPermissions';

/**
 * @RequiresPermission() decorator.
 *
 * Declares the minimum set of permissions required to access a route handler.
 * The PermissionGuard reads this metadata and checks each permission against
 * the user's effective permissions using CASL (AUTHZ-5).
 *
 * Multiple permissions are AND-ed — the user must have ALL of them.
 * To express OR logic, define multiple route handlers or check in the use case.
 *
 * @example
 * ```typescript
 * @RequiresPermission('inventory:product:read')
 * @Get('products')
 * async listProducts() { ... }
 *
 * @RequiresPermission('inventory:product:write', 'inventory:stock:adjust')
 * @Post('products')
 * async createProduct() { ... }
 * ```
 *
 * @see AUTHZ-5 — Permission checks are declarative via @RequiresPermission
 * @see PermissionGuard — reads this metadata at runtime
 */
export const RequiresPermission = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
