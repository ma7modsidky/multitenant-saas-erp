import { type SearchContributor, type SearchResult } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DRIZZLE_DB, type DrizzleDb } from '../../../core/database/drizzle.provider.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';

/**
 * Federated-search contributor for the purchasing module.
 *
 * Searches suppliers by name/code and purchase orders by number inside a
 * `runWithOrg` transaction so RLS scopes every query to the organization passed
 * by the platform search use case — the contributor never filters by
 * `organization_id` itself.
 *
 * Registered by the composition root (app.module.ts) as a `SEARCH_CONTRIBUTORS`
 * multi-provider when the descriptor declares `searchContributor: true`.
 *
 * @see ARCHITECTURE.md §6 — Federated search
 * @see MODULE_GUIDE.md §3 — search/ contributor
 */
@Injectable()
export class PurchasingSearchContributor implements SearchContributor {
  readonly moduleKey = 'purchasing';
  readonly labelKey = 'modules.purchasing.name';

  constructor(
    private readonly tx: TransactionManager,
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
  ) {}

  async search(query: string, organizationId: string, limit: number): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const results = await this.tx.runWithOrg(organizationId, async (db) => {
      const postgres = db as unknown as PostgresJsDatabase;
      const rows = await postgres.execute<{
        kind: string;
        id: string;
        title: string;
        description: string | null;
      }>(sql`
        SELECT 'supplier' AS kind, s.id AS id, s.name AS title, s.code AS description
        FROM pur_suppliers s
        WHERE s.deleted_at IS NULL AND (s.name ILIKE ${`%${trimmed}%`} OR s.code ILIKE ${`%${trimmed}%`})
        UNION ALL
        SELECT 'po' AS kind, po.id AS id, po.number AS title, sup.name AS description
        FROM pur_purchase_orders po
        JOIN pur_suppliers sup ON sup.id = po.supplier_id
        WHERE po.deleted_at IS NULL AND po.number ILIKE ${`%${trimmed}%`}
        UNION ALL
        SELECT 'bill' AS kind, b.id AS id, b.number AS title, sup.name AS description
        FROM pur_bills b
        JOIN pur_suppliers sup ON sup.id = b.supplier_id
        WHERE b.deleted_at IS NULL AND b.number ILIKE ${`%${trimmed}%`}
        LIMIT ${limit}
      `);
      return rows.map((row) => ({
        id: `${row.kind}:${row.id}`,
        title: row.title,
        ...(row.description ? { description: row.description } : {}),
        href:
          row.kind === 'supplier'
            ? `/m/purchasing/suppliers/${row.id}`
            : row.kind === 'po'
              ? `/m/purchasing/purchase-orders/${row.id}`
              : `/m/purchasing/bills/${row.id}`,
        icon: row.kind === 'supplier' ? 'users' : row.kind === 'po' ? 'file-text' : 'receipt',
      }));
    });

    return results.slice(0, limit);
  }
}
