/**
 * @deprecated Import from `@/core/tenancy` instead.
 * This file re-exports from the canonical tenancy module location.
 *
 * The TenantContext was moved to core/tenancy in Phase 1.2.
 * This re-export ensures backward compatibility for code that
 * imported from `./database/tenant-context.js`.
 */
export {
  TenantContext,
  type TenantContextData,
} from '../tenancy/tenant-context.js';
