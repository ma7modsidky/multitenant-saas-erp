import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DRIZZLE_DB, type DrizzleDb } from './drizzle.provider.js';
import { type TxOrDb } from './repository.base.js';
import { TenantContext } from './tenant-context.js';

/**
 * TransactionManager — the ONLY code allowed to set tenant session variables.
 *
 * Every database access in the application must happen inside `TransactionManager.run()`.
 * It opens a database transaction, binds the tenant context via `SET LOCAL`,
 * and runs the provided callback within that context.
 *
 * The `SET LOCAL` (with `true` as the third argument) is transaction-scoped,
 * so it's safe with connection pooling (including PgBouncer in transaction mode).
 * After the transaction ends, the session variables are automatically cleared.
 *
 * RLS policy uses:
 *   organization_id = current_setting('app.current_organization_id', true)::uuid
 *
 * When the setting is unset (NULL), RLS returns zero rows — fail-closed.
 *
 * @see DATA_MODEL.md §2 — Per-request binding
 * @see DATA_MODEL.md §2 — RLS pattern
 * @see ARCHITECTURE.md §5 — Request lifecycle
 */
@Injectable()
export class TransactionManager {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  /**
   * Run a callback inside a tenant-bound database transaction.
   *
   * Steps:
   *   1. Opens a database transaction
   *   2. Sets `app.current_organization_id` from the active TenantContext
   *   3. Sets `app.current_user_id` from the active TenantContext
   *   4. Executes the callback with the transaction-scoped db
   *   5. Commits on success, rolls back on error
   *
   * @typeParam T - The return type of the callback
   * @param fn - The callback to execute within the transaction
   * @returns The result of the callback
   * @throws {Error} If no TenantContext is available
   */
  async run<T>(fn: (tx: TxOrDb) => Promise<T>): Promise<T> {
    const ctx = TenantContext.getCurrent();

    if (!ctx) {
      throw new Error(
        'Cannot run transaction without tenant context. ' +
          'Ensure the request is authenticated and has a valid organization selected. ' +
          'System-context operations should not use TransactionManager directly.',
      );
    }

    return this.db.transaction(async (tx) => {
      // Bind tenant context to the transaction via session variables
      // The third argument (true) makes this transaction-local
      await tx.execute(sql`SELECT set_config('app.current_organization_id', ${ctx.organizationId}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`);

      // Run the callback with the transaction-scoped db
      return fn(tx);
    });
  }
}
