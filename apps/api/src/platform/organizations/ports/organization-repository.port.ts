import type { TxOrDb } from '../../../core/database/repository.base.js';
import { type OrganizationData, type OrganizationSettingsData } from '../domain/index.js';

/**
 * OrganizationRepository — persistence interface for organizations.
 *
 * core_organizations is a GLOBAL (non-tenant) table, so the standard
 * RepositoryBase with auto-applied tenant filtering is NOT used.
 * Access is governed by membership queries, not RLS.
 *
 * @see DATA_MODEL.md §4.1 — Global (non-tenant) tables
 */
export interface OrganizationRepository {
  /** Find organization by its primary key. */
  findById(id: string, tx?: TxOrDb): Promise<OrganizationData | undefined>;

  /** Find organization by its unique slug. */
  findBySlug(slug: string, tx?: TxOrDb): Promise<OrganizationData | undefined>;

  /** Check if a slug is already taken by another organization. */
  isSlugTaken(slug: string, excludeOrgId?: string, tx?: TxOrDb): Promise<boolean>;

  /** Insert a new organization. */
  insert(data: OrganizationData, tx?: TxOrDb): Promise<OrganizationData>;

  /** Update an existing organization. */
  update(id: string, data: Partial<OrganizationData>, tx?: TxOrDb): Promise<OrganizationData | undefined>;

  // ─── Settings ───────────────────────────────────────────────────────────

  /** Find organization settings by organization ID. */
  findSettingsByOrgId(organizationId: string, tx?: TxOrDb): Promise<OrganizationSettingsData | undefined>;

  /** Insert or update organization settings (upsert by organization_id). */
  upsertSettings(data: OrganizationSettingsData, tx?: TxOrDb): Promise<OrganizationSettingsData>;
}

/** Injection token for the OrganizationRepository. */
export const ORGANIZATION_REPOSITORY = Symbol('ORGANIZATION_REPOSITORY');
