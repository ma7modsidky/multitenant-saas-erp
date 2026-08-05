import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { type SearchContributor, type SearchResult } from '@modubiz/contracts';

import { DRIZZLE_DB, type DrizzleDb } from '../../../core/database/drizzle.provider.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';

/**
 * Federated-search contributor for the crm module.
 *
 * Searches the four tenant tables (contacts, companies, deals, activities)
 * inside a `runWithOrg` transaction so RLS scopes every query to the
 * organization passed by the platform search use case — the contributor never
 * filters by `organization_id` itself.
 *
 * Registered by the composition root (app.module.ts) as a `SEARCH_CONTRIBUTORS`
 * multi-provider when the descriptor declares `searchContributor: true`.
 *
 * @see ARCHITECTURE.md §6 — Federated search
 * @see MODULE_GUIDE.md §3 — search/ contributor
 */
@Injectable()
export class CrmSearchContributor implements SearchContributor {
  readonly moduleKey = 'crm';
  readonly labelKey = 'modules.crm.name';

  constructor(
    private readonly tx: TransactionManager,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
  ) {}

  /**
   * Search the module's tenant tables, newest-first per entity type, capped at
   * `limit` results overall (spread evenly across the four entities).
   */
  async search(query: string, organizationId: string, limit: number): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const perEntity = Math.max(1, Math.floor(limit / 4));
    const results = await this.tx.runWithOrg(organizationId, async (db) => {
      const postgres = db as unknown as PostgresJsDatabase;
      const [contacts, companies, deals, activities] = await Promise.all([
        this.searchContacts(postgres, trimmed, perEntity),
        this.searchCompanies(postgres, trimmed, perEntity),
        this.searchDeals(postgres, trimmed, perEntity),
        this.searchActivities(postgres, trimmed, perEntity),
      ]);
      return [...contacts, ...companies, ...deals, ...activities];
    });

    return results.slice(0, limit);
  }

  private async searchContacts(db: PostgresJsDatabase, query: string, limit: number): Promise<SearchResult[]> {
    const rows = await db.execute<{ id: string; first_name: string; last_name: string; email: string | null }>(sql`
      SELECT id, first_name, last_name, email
      FROM crm_contacts
      WHERE deleted_at IS NULL
        AND (first_name ILIKE ${`%${query}%`} OR last_name ILIKE ${`%${query}%`} OR email ILIKE ${`%${query}%`})
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `);
    return rows.map((row) => ({
      id: `contact:${row.id}`,
      title: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.id,
      // exactOptionalPropertyTypes: only set `description` when present.
      ...(row.email ? { description: row.email } : {}),
      href: `/m/crm/contacts/${row.id}`,
      icon: 'contact',
    }));
  }

  private async searchCompanies(db: PostgresJsDatabase, query: string, limit: number): Promise<SearchResult[]> {
    const rows = await db.execute<{ id: string; name: string; domain: string | null }>(sql`
      SELECT id, name, domain
      FROM crm_companies
      WHERE deleted_at IS NULL
        AND (name ILIKE ${`%${query}%`} OR domain ILIKE ${`%${query}%`})
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `);
    return rows.map((row) => ({
      id: `company:${row.id}`,
      title: row.name,
      ...(row.domain ? { description: row.domain } : {}),
      href: `/m/crm/companies/${row.id}`,
      icon: 'building',
    }));
  }

  private async searchDeals(db: PostgresJsDatabase, query: string, limit: number): Promise<SearchResult[]> {
    const rows = await db.execute<{ id: string; title: string }>(sql`
      SELECT id, title
      FROM crm_deals
      WHERE deleted_at IS NULL AND title ILIKE ${`%${query}%`}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `);
    return rows.map((row) => ({
      id: `deal:${row.id}`,
      title: row.title,
      href: `/m/crm/deals/${row.id}`,
      icon: 'target',
    }));
  }

  private async searchActivities(db: PostgresJsDatabase, query: string, limit: number): Promise<SearchResult[]> {
    const rows = await db.execute<{ id: string; subject: string }>(sql`
      SELECT id, subject
      FROM crm_activities
      WHERE deleted_at IS NULL AND subject ILIKE ${`%${query}%`}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `);
    return rows.map((row) => ({
      id: `activity:${row.id}`,
      title: row.subject,
      href: `/m/crm/activities/${row.id}`,
      icon: 'activity',
    }));
  }
}
