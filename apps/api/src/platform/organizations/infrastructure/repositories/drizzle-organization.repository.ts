import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import type { OrganizationData, OrganizationSettingsData } from '../../domain/index.js';
import type { OrganizationRepository } from '../../ports/index.js';

/**
 * DrizzleOrganizationRepository — Drizzle implementation of OrganizationRepository.
 *
 * Since core_organizations is a global (non-RLS) table, queries do NOT
 * auto-filter by organization_id. Access control is handled by the
 * application layer through membership checks.
 *
 * Uses raw SQL with sql`` tag for table references since Drizzle schema
 * files haven't been generated yet. All column references use snake_case
 * to match the database schema; manual mapping is applied at the
 * row-to-domain boundary.
 */
@Injectable()
export class DrizzleOrganizationRepository implements OrganizationRepository {
  private readonly orgTable = sql.identifier('core_organizations');
  private readonly settingsTable = sql.identifier('core_organization_settings');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async findById(id: string, tx?: TxOrDb): Promise<OrganizationData | undefined> {
    const db = this.getDb(tx);

    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.orgTable} WHERE id = ${id} LIMIT 1`,
    );

    const row = rows[0];
    if (!row) return undefined;
    return this.rowToOrganization(row);
  }

  async findBySlug(slug: string, tx?: TxOrDb): Promise<OrganizationData | undefined> {
    const db = this.getDb(tx);

    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.orgTable} WHERE slug = ${slug} LIMIT 1`,
    );

    const row = rows[0];
    if (!row) return undefined;
    return this.rowToOrganization(row);
  }

  async isSlugTaken(slug: string, excludeOrgId?: string, tx?: TxOrDb): Promise<boolean> {
    const db = this.getDb(tx);

    const condition = excludeOrgId
      ? sql`slug = ${slug} AND id != ${excludeOrgId}`
      : sql`slug = ${slug}`;

    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT id FROM ${this.orgTable} WHERE ${condition} LIMIT 1`,
    );

    return rows.length > 0;
  }

  async insert(data: OrganizationData, tx?: TxOrDb): Promise<OrganizationData> {
    const db = this.getDb(tx);

    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.orgTable}
          (id, name, slug, country_code, timezone, base_currency,
           default_locale, status, deletion_scheduled_at, created_at, updated_at)
        VALUES
          (${data.id}, ${data.name}, ${data.slug}, ${data.countryCode}, ${data.timezone},
           ${data.baseCurrency}, ${data.defaultLocale}, ${data.status},
           ${data.deletionScheduledAt}, ${data.createdAt}, ${data.updatedAt})
        RETURNING *
      `,
    );

    const row = rows[0];
    if (!row) throw new Error('INSERT RETURNING returned no rows');
    return this.rowToOrganization(row);
  }

  async update(id: string, data: Partial<OrganizationData>, tx?: TxOrDb): Promise<OrganizationData | undefined> {
    const db = this.getDb(tx);

    // Build SET clause with parameterized values using sql`` tag fragments.
    const setFragments: ReturnType<typeof sql>[] = [sql`updated_at = NOW()`];

    if (data.name !== undefined) {
      setFragments.push(sql`name = ${data.name}`);
    }
    if (data.slug !== undefined) {
      setFragments.push(sql`slug = ${data.slug}`);
    }
    if (data.countryCode !== undefined) {
      setFragments.push(sql`country_code = ${data.countryCode}`);
    }
    if (data.timezone !== undefined) {
      setFragments.push(sql`timezone = ${data.timezone}`);
    }
    if (data.baseCurrency !== undefined) {
      setFragments.push(sql`base_currency = ${data.baseCurrency}`);
    }
    if (data.defaultLocale !== undefined) {
      setFragments.push(sql`default_locale = ${data.defaultLocale}`);
    }
    if (data.status !== undefined) {
      setFragments.push(sql`status = ${data.status}`);
    }
    if (data.deletionScheduledAt !== undefined) {
      setFragments.push(sql`deletion_scheduled_at = ${data.deletionScheduledAt}`);
    }

    const setClause = sql.join(setFragments, sql.raw(', '));

    const rows = await db.execute<Record<string, unknown>>(
      sql`UPDATE ${this.orgTable} SET ${setClause} WHERE id = ${id} RETURNING *`,
    );

    const row = rows[0];
    if (!row) return undefined;
    return this.rowToOrganization(row);
  }

  async findSettingsByOrgId(organizationId: string, tx?: TxOrDb): Promise<OrganizationSettingsData | undefined> {
    const db = this.getDb(tx);

    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.settingsTable} WHERE organization_id = ${organizationId} LIMIT 1`,
    );

    const row = rows[0];
    if (!row) return undefined;
    return this.rowToSettings(row);
  }

  async upsertSettings(data: OrganizationSettingsData, tx?: TxOrDb): Promise<OrganizationSettingsData> {
    const db = this.getDb(tx);

    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.settingsTable}
          (organization_id, locale, timezone, base_currency,
           number_preferences, date_preferences, receipt_footer)
        VALUES
          (${data.organizationId}, ${data.locale}, ${data.timezone}, ${data.baseCurrency},
           ${JSON.stringify(data.numberPreferences)}::jsonb,
           ${JSON.stringify(data.datePreferences)}::jsonb,
           ${data.receiptFooter})
        ON CONFLICT (organization_id)
        DO UPDATE SET
          locale = EXCLUDED.locale,
          timezone = EXCLUDED.timezone,
          base_currency = EXCLUDED.base_currency,
          number_preferences = EXCLUDED.number_preferences,
          date_preferences = EXCLUDED.date_preferences,
          receipt_footer = EXCLUDED.receipt_footer,
          updated_at = NOW()
        RETURNING *
      `,
    );

    const row = rows[0];
    if (!row) throw new Error('UPSERT RETURNING returned no rows');
    return this.rowToSettings(row);
  }

  // ─── Row mapping ────────────────────────────────────────────────────────

  private rowToOrganization(row: Record<string, unknown>): OrganizationData {
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      countryCode: row.country_code as string,
      timezone: row.timezone as string,
      baseCurrency: row.base_currency as string,
      defaultLocale: row.default_locale as string,
      status: row.status as OrganizationData['status'],
      deletionScheduledAt: (row.deletion_scheduled_at as Date | null) ?? null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }

  private rowToSettings(row: Record<string, unknown>): OrganizationSettingsData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      locale: row.locale as string,
      timezone: row.timezone as string,
      baseCurrency: row.base_currency as string,
      numberPreferences: typeof row.number_preferences === 'string'
        ? JSON.parse(row.number_preferences as string)
        : (row.number_preferences as Record<string, unknown>),
      datePreferences: typeof row.date_preferences === 'string'
        ? JSON.parse(row.date_preferences as string)
        : (row.date_preferences as Record<string, unknown>),
      receiptFooter: (row.receipt_footer as string | null) ?? null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }
}
