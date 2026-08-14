import type { TxOrDb } from '../../../core/database/repository.base.js';

// ─── Platform admin audit trail (PLT-4) ────────────────────────────────────

export interface PlatformAuditEntry {
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface PlatformAuditRepository {
  /** Append an entry to core_platform_audit_log (append-only, AUD-2). */
  insert(entry: PlatformAuditEntry, tx?: TxOrDb): Promise<void>;
}

export const PLATFORM_AUDIT_REPOSITORY = Symbol('PLATFORM_AUDIT_REPOSITORY');

// ─── SaaS settings (PLT-7) ──────────────────────────────────────────────────

export interface SaasSettingsRepository {
  /** All settings as `{ key, value, updatedAt }` rows. */
  getAll(tx?: TxOrDb): Promise<Array<{ key: string; value: unknown; updatedAt: Date }>>;
  /** Upsert a single setting by key. */
  set(key: string, value: unknown, updatedBy: string | null, tx?: TxOrDb): Promise<void>;
}

export const SAAS_SETTINGS_REPOSITORY = Symbol('SAAS_SETTINGS_REPOSITORY');

// ─── Module pricing (PLT-6) ─────────────────────────────────────────────────

export interface ModulePricingRow {
  moduleKey: string;
  name: string;
  description: string | null;
  icon: string | null;
  dependsOn: string[];
  /** Integer minor units, serialized as string (CUR-9). */
  priceMonthlyMinor: string;
  priceYearlyMinor: string;
  currency: string;
}

export interface ModulePricingRepository {
  /** Catalog entries LEFT JOINed with their (possibly missing) pricing row. */
  listWithCatalog(tx?: TxOrDb): Promise<ModulePricingRow[]>;
  /** Upsert a module's pricing row (admin-editable, PLT-6). */
  upsert(
    data: {
      moduleKey: string;
      priceMonthlyMinor: string;
      priceYearlyMinor: string;
      currency: string;
      updatedBy: string | null;
    },
    tx?: TxOrDb,
  ): Promise<void>;
}

export const MODULE_PRICING_REPOSITORY = Symbol('MODULE_PRICING_REPOSITORY');

// ─── Org directory (global reads; per-org state via runWithOrg) ─────────────

export interface AdminOrgRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
}

export interface AdminDirectoryRepository {
  /** Global list of organizations (core_organizations has no RLS). */
  listOrgs(search: string | undefined, limit: number, offset: number, tx?: TxOrDb): Promise<AdminOrgRow[]>;
  /** Global count of organizations matching the search. */
  countOrgs(search: string | undefined, tx?: TxOrDb): Promise<number>;
  /** Total users on the platform (core_users, global). */
  countUsers(tx?: TxOrDb): Promise<number>;
  /** One organization by id (global). */
  findOrgById(id: string, tx?: TxOrDb): Promise<AdminOrgRow | undefined>;
}

export const ADMIN_DIRECTORY_REPOSITORY = Symbol('ADMIN_DIRECTORY_REPOSITORY');
