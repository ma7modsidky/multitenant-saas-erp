import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for the module that a route belongs to.
 */
export const REQUIRED_MODULE_KEY = 'authorization:requiredModule';

/**
 * @RequiresModule() decorator.
 *
 * Declares which business module a route handler belongs to. The
 * EntitlementGuard checks whether the active organization is entitled
 * to this module before the request proceeds to permission checks.
 *
 * This implements AUTHZ-6: entitlement is checked BEFORE permission.
 * An unentitled module returns `403 MODULE_NOT_ENTITLED` even for an OWNER.
 *
 * @example
 * ```typescript
 * @Controller('products')
 * @RequiresModule('inventory')
 * export class ProductsController {
 *   @Get()
 *   @RequiresPermission('inventory:product:read')
 *   async list() { ... }
 * }
 * ```
 *
 * The decorator can be applied at the class level (entire controller) or
 * method level (specific route). Class-level metadata applies to all routes
 * unless overridden by a method-level decorator.
 *
 * @see AUTHZ-6 — Entitlement is checked before permission
 * @see EntitlementGuard — reads this metadata at runtime
 */
export const RequiresModule = (moduleKey: string) =>
  SetMetadata(REQUIRED_MODULE_KEY, moduleKey);
