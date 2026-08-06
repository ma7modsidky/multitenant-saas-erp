import { type SearchContributor, type SearchResult } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DRIZZLE_DB, type DrizzleDb } from '../../../core/database/drizzle.provider.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';

/**
 * Federated-search contributor for the inventory module.
 *
 * Searches products by localized name and variant SKU inside a `runWithOrg`
 * transaction so RLS scopes every query to the organization passed by the
 * platform search use case — the contributor never filters by
 * `organization_id` itself.
 *
 * Registered by the composition root (app.module.ts) as a `SEARCH_CONTRIBUTORS`
 * multi-provider when the descriptor declares `searchContributor: true`.
 *
 * @see ARCHITECTURE.md §6 — Federated search
 * @see MODULE_GUIDE.md §3 — search/ contributor
 */
@Injectable()
export class InventorySearchContributor implements SearchContributor {
  readonly moduleKey = 'inventory';
  readonly labelKey = 'modules.inventory.name';

  constructor(
    private readonly tx: TransactionManager,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
  ) {}

  async search(query: string, organizationId: string, limit: number): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const results = await this.tx.runWithOrg(organizationId, async (db) => {
      const postgres = db as unknown as PostgresJsDatabase;
      // Match on the generated name_default column (name_i18n ->> 'en') or SKU.
      const rows = await postgres.execute<{
        product_id: string;
        variant_id: string | null;
        name_default: string | null;
        sku: string | null;
      }>(sql`
        SELECT DISTINCT ON (p.id)
          p.id AS product_id,
          v.id AS variant_id,
          p.name_default,
          v.sku
        FROM inv_products p
        LEFT JOIN inv_product_variants v ON v.product_id = p.id AND v.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
          AND (p.name_default ILIKE ${`%${trimmed}%`} OR v.sku ILIKE ${`%${trimmed}%`})
        ORDER BY p.id, p.updated_at DESC
        LIMIT ${limit}
      `);
      return rows.map((row) => ({
        id: `product:${row.product_id}`,
        title: row.name_default ?? row.sku ?? row.product_id,
        ...(row.sku ? { description: row.sku } : {}),
        href: `/m/inventory/products`,
        icon: 'package',
      }));
    });

    return results.slice(0, limit);
  }
}
