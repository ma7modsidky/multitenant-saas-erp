import { type TransactionRef } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DRIZZLE_DB, type DrizzleDb } from './drizzle.provider.js';
import { type TxOrDb } from './repository.base.js';
import { TenantContext } from './tenant-context.js';

/** The unique symbol carried by every minted TransactionRef. */
const TRANSACTION_REF: unique symbol = Symbol('TransactionRef');

/**
 * TransactionManager — the ONLY code allowed to set tenant session variables.
 *
 * Every database access in the application must happen inside `TransactionManager.run()`.
 * It opens a database transaction, binds the tenant context via `SET LOCAL`,
 * and runs the provided callback within that context.
 *
 * The `SET LOCAL` (with `true` as the third argument) is transaction-scoped,
 * so it's safe with connection pooling (including PgBouncer in transaction mode).
 * Note: PostgreSQL resets touched custom GUCs to the EMPTY STRING (not NULL)
 * after commit, so RLS policies MUST wrap the setting in NULLIF(..., '') — see
 * migration 0008 and DATA_MODEL.md §2.
 *
 * RLS policy uses:
 *   organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
 *
 * When the setting is unset (NULL) or reset (''), RLS returns zero rows — fail-closed.
 *
 * @see DATA_MODEL.md §2 — Per-request binding
 * @see DATA_MODEL.md §2 — RLS pattern
 * @see ARCHITECTURE.md §5 — Request lifecycle
 */
@Injectable()
export class TransactionManager {
  /** Minted TransactionRef handles → the ambient tx they wrap. */
  private readonly refs = new WeakMap<object, TxOrDb>();

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
      // Bind tenant context to the transaction via session variables.
      // The third argument (true) makes this transaction-local.
      //
      // IMPORTANT: variables are left UNSET when the context has no value.
      // RLS policies (0008) wrap the setting in NULLIF(..., '') so both unset
      // (NULL) and the Postgres reset value ('') fail closed — zero rows,
      // never an `invalid input syntax for type uuid: ""` crash. See also
      // switch-org: a freshly signed-up user's token has no organizationId
      // yet, so only `app.current_user_id` is bound, letting the
      // `user_own_memberships` policy (0007) serve the membership lookup
      // while tenant-scoped rows stay hidden.
      if (ctx.organizationId !== undefined) {
        await tx.execute(sql`SELECT set_config('app.current_organization_id', ${ctx.organizationId}, true)`);
      }
      if (ctx.userId !== undefined) {
        await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`);
      }

      // Run the callback with the transaction-scoped db
      return fn(tx);
    });
  }

  /**
   * Mint an opaque TransactionRef bound to the ambient transaction.
   *
   * Level 3 port implementations receive a `TransactionRef` (never a raw tx)
   * so they can join the CALLER's transaction instead of opening their own
   * (ARCHITECTURE.md §6). The ref is opaque: consumers and implementations
   * cannot inspect or construct it — only this manager can resolve it back.
   *
   * Must be called inside `run()`/`runWithOrg()` with the callback's `tx`.
   */
  ref(tx: TxOrDb): TransactionRef {
    // The `unique symbol` property is intentionally unconstructable from
    // outside (that is the opacity) — this minting site is the only place
    // allowed to forge it.
    const handle = { __transactionRef: TRANSACTION_REF } as unknown as TransactionRef;
    this.refs.set(handle, tx);
    return handle;
  }

  /**
   * Resolve a TransactionRef back to the transaction-scoped db client.
   * @throws {Error} when the ref was not minted by this manager (or already GC'd).
   */
  resolveRef(ref: TransactionRef): TxOrDb {
    const tx = this.refs.get(ref);
    if (!tx) {
      throw new Error('TransactionRef is not valid in this context; it was not minted by TransactionManager.');
    }
    return tx;
  }

  /**
   * Run a callback inside a transaction bound to a SPECIFIC organization.
   *
   * Same guarantees as run(), but binds `app.current_organization_id` to the
   * provided organization instead of the one in TenantContext. Used for the
   * invitation-accept flow: the invitee is not yet a member and their token
   * carries no org, so the accept write must be scoped to the invitation's
   * organization (AUTH-3, AUTH-9).
   *
   * `app.current_user_id` is still bound from TenantContext so the invitee's
   * own identity is available to RLS policies (e.g. user_own_invitations).
   */
  async runWithOrg<T>(organizationId: string, fn: (tx: TxOrDb) => Promise<T>): Promise<T> {
    const ctx = TenantContext.getCurrent();

    if (!ctx) {
      throw new Error(
        'Cannot run transaction without tenant context. ' +
          'Ensure the request is authenticated and has a valid organization selected. ' +
          'System-context operations should not use TransactionManager directly.',
      );
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_organization_id', ${organizationId}, true)`);
      if (ctx.userId !== undefined) {
        await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`);
      }

      return fn(tx);
    });
  }
}
