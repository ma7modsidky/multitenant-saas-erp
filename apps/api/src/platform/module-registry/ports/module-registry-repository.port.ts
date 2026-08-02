import type { TxOrDb } from '../../../core/database/repository.base.js';

/**
 * Repository for reading/writing module catalog and entitlement data.
 *
 * @see PLAN.md §2.7 — Module registry
 */
export interface ModuleRegistryRepository {
  /** Get a module catalog entry by key. */
  getModule(
    key: string,
    tx?: TxOrDb,
  ): Promise<
    | {
        key: string;
        name: string;
        description: string | null;
        icon: string | null;
        dependsOn: string[];
        stripePriceKey: string | null;
        trialDays: number;
      }
    | undefined
  >;

  /** Upsert a module catalog entry. */
  upsertModule(
    data: {
      key: string;
      version: string;
      name: string;
      description: string | null;
      icon: string | null;
      dependsOn: string[];
      tablePrefix: string;
      stripePriceKey: string | null;
      trialDays: number;
    },
    tx?: TxOrDb,
  ): Promise<void>;

  /** Get all module catalog entries. */
  listModules(tx?: TxOrDb): Promise<
    Array<{
      key: string;
      name: string;
      description: string | null;
      icon: string | null;
      dependsOn: string[];
      trialDays: number;
    }>
  >;

  /** Upsert a permission key. */
  upsertPermission(key: string, moduleKey: string, description: string | null, tx?: TxOrDb): Promise<void>;

  /**
   * Remove catalog rows (and their permissions) for modules that are no longer
   * registered.
   *
   * The catalog is mirrored from descriptors at boot, so a true mirror must also
   * prune stale entries — otherwise a module removed from `registered-modules.ts`
   * keeps showing up in the marketplace forever.
   *
   * Rows still referenced by a dependent row are kept (the FK is NO ACTION and
   * `core_module_entitlements` / `core_role_permissions` are RLS-protected, so we
   * cannot pre-check from the boot context — the FK violation itself is the
   * guard) and reported in `kept`.
   *
   * MUST be called outside an explicit transaction: the keep-on-FK-violation
   * behavior relies on per-statement autocommit. Inside a transaction, a 23503
   * aborts the whole transaction, so no `tx` parameter is accepted.
   *
   * @returns `{ removed, kept }` — the pruned module keys and the ones that were
   *          left in place because a dependent row still references them.
   */
  pruneStaleModules(registeredKeys: string[]): Promise<{ removed: string[]; kept: string[] }>;

  /** Get all registered permission keys. */
  listPermissions(tx?: TxOrDb): Promise<Array<{ key: string; moduleKey: string; description: string | null }>>;

  /** Get entitlement state for an org + module. */
  getEntitlement(organizationId: string, moduleKey: string, tx?: TxOrDb): Promise<{ state: string } | undefined>;

  /** Get all entitlements for an org. */
  listEntitlements(organizationId: string, tx?: TxOrDb): Promise<Array<{ moduleKey: string; state: string }>>;

  /** Get all modules that depend on the given module. */
  getDependentModules(moduleKey: string, tx?: TxOrDb): Promise<string[]>;

  /** Set entitlement state. */
  updateEntitlementState(
    organizationId: string,
    moduleKey: string,
    state: string,
    updatedBy: string,
    tx?: TxOrDb,
  ): Promise<void>;
}

export const MODULE_REGISTRY_REPOSITORY = Symbol('MODULE_REGISTRY_REPOSITORY');
