import { TenantContext } from './tenant-context.js';

/**
 * withoutTenantContext — test helper for verifying fail-closed behaviour.
 *
 * Temporarily clears any active TenantContext for the duration of the callback,
 * so tests can verify that operations properly fail or return zero rows
 * when executed outside a tenant context.
 *
 * This implements the test for **TEN-3**: no tenant context ⇒ zero rows, never all rows.
 *
 * @example
 * ```typescript
 * import { withoutTenantContext } from '@/core/tenancy';
 *
 * it('TEN-3: rejects operations without tenant context', async () => {
 *   await withoutTenantContext(async () => {
 *     await expect(
 *       transactionManager.run(async (tx) => { ... }),
 *     ).rejects.toThrow('No tenant context available');
 *   });
 * });
 * ```
 */
export async function withoutTenantContext<T>(fn: () => Promise<T>): Promise<T> {
  // Save the current context, then clear it by running inside a new context
  // with undefined. The TenantContext class exposes a static method for this.
  return TenantContext.runWithCleanContext(fn);
}
