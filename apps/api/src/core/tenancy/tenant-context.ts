import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Tenant context data carried per request.
 *
 * Stores the current request's identity and authorization context in an
 * AsyncLocalStorage, so that TransactionManager and other core services
 * can access them without passing them through every function call.
 *
 * The context is set by the tenant middleware after auth verification,
 * and restored by background job processors from the job payload.
 *
 * @see ARCHITECTURE.md §5 — Request lifecycle
 * @see DATA_MODEL.md §2 — Per-request binding
 */
export interface TenantContextData {
  /** Authenticated user's ID */
  userId: string;
  /** Active organization ID (undefined for system-context routes) */
  organizationId: string | undefined;
  /** User's role keys within the active organization */
  roles: string[];
  /** Effective permission keys for the user in the active org */
  permissions: string[];
  /** Resolved locale for the request (explicit → user → org → default → 'en') */
  locale: string;
}

/**
 * TenantContext — AsyncLocalStorage-based tenant context.
 *
 * Stores the current request's userId and organizationId in an async context,
 * so that TransactionManager can access them without passing them through
 * every function call.
 *
 * The context is set by the tenant middleware (Phase 1.2) after auth verification,
 * and restored by background job processors from the job payload.
 *
 * @example
 * ```typescript
 * // Set context for the request scope
 * await TenantContext.run(
 *   { userId: '...', organizationId: '...', roles: ['ADMIN'], permissions: [], locale: 'en' },
 *   async () => {
 *     // All code here has access to the tenant context
 *     const orgId = TenantContext.getOrganizationId();
 *   },
 * );
 * ```
 */
export class TenantContext {
  private static readonly storage = new AsyncLocalStorage<TenantContextData>();

  /**
   * Run a function with a specific tenant context.
   * All async operations within the callback will have access to this context
   * via the static getters.
   */
  static run<T>(data: TenantContextData, fn: () => Promise<T>): Promise<T> {
    return this.storage.run(data, fn);
  }

  /**
   * Run a function with no tenant context set.
   * Used by the withoutTenantContext() test helper to verify fail-closed
   * behaviour (TEN-3: no tenant context ⇒ zero rows).
   *
   * Creates a nested scope where the store value is undefined,
   * temporarily overriding any inherited context from the caller.
   * After the callback completes, the outer scope is restored.
   */
  static runWithCleanContext<T>(fn: () => Promise<T>): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return this.storage.run(undefined as unknown as TenantContextData, fn);
  }

  /**
   * Get the current tenant context data.
   * Returns undefined if no context is set (e.g., system-context routes).
   */
  static getCurrent(): TenantContextData | undefined {
    return this.storage.getStore();
  }

  /**
   * Get the current organization ID.
   * Returns undefined if no tenant context is available (system-context route).
   * Throws if context exists but has no organizationId (should not happen).
   */
  static getOrganizationId(): string | undefined {
    const ctx = this.getCurrent();
    return ctx?.organizationId;
  }

  /**
   * Require the current organization ID.
   * Throws if no tenant context or organization ID is available.
   * Use this in use cases that must run within a tenant context.
   */
  static requireOrganizationId(): string {
    const ctx = this.getCurrent();
    if (!ctx) {
      throw new Error(
        'No tenant context available. ' +
          'This operation requires an active tenant context. ' +
          'Ensure the request is authenticated and has passed through tenant middleware.',
      );
    }
    if (!ctx.organizationId) {
      throw new Error(
        'No organization ID in tenant context. ' +
          'This operation requires an active organization context, ' +
          'but the request is in a system context without an organization.',
      );
    }
    return ctx.organizationId;
  }

  /**
   * Get the current user ID.
   * Returns undefined if no tenant context is available.
   */
  static getUserId(): string | undefined {
    return this.getCurrent()?.userId;
  }

  /**
   * Require the current user ID.
   * Throws if no tenant context is available.
   */
  static requireUserId(): string {
    const userId = this.getUserId();
    if (!userId) {
      throw new Error(
        'No tenant context available. ' +
          'This operation requires an active tenant context.',
      );
    }
    return userId;
  }

  /**
   * Get the current user's roles.
   * Returns empty array if no tenant context is available.
   */
  static getRoles(): string[] {
    return this.getCurrent()?.roles ?? [];
  }

  /**
   * Get the current user's effective permissions.
   * Returns empty array if no tenant context is available.
   */
  static getPermissions(): string[] {
    return this.getCurrent()?.permissions ?? [];
  }

  /**
   * Get the current request locale.
   * Returns 'en' as fallback if no tenant context is available.
   */
  static getLocale(): string {
    return this.getCurrent()?.locale ?? 'en';
  }
}
