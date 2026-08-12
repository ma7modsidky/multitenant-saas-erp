import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { TxOrDb } from '../database/repository.base.js';

/**
 * A loader that reads the pre-mutation state of an entity.
 *
 * Runs inside a tenant-bound transaction, so RLS scopes the read to the
 * caller's organization — a foreign or deleted id yields zero rows → null
 * (fail closed, TEN-3).
 */
export interface AuditBeforeStateLoader {
  load(id: string, tx: TxOrDb): Promise<Record<string, unknown> | null>;
}

/**
 * AuditBeforeStateRegistry — module-supplied loaders that capture the
 * pre-mutation state of an entity for `@Audit({ captureBefore: true })` routes.
 *
 * Core cannot read module tables (dependency direction: modules → core), so
 * each module registers a loader per entityType at bootstrap (AUD-1 — entries
 * carry a before/after snapshot). A missing loader fails soft: the interceptor
 * records `before: null` and the originating request is never affected
 * (NOTIF-1 pattern).
 *
 * @see BUSINESS_RULES.md — AUD-1 (mutations write before/after snapshots)
 */
@Injectable()
export class AuditBeforeStateRegistry {
  private readonly loaders = new Map<string, AuditBeforeStateLoader>();

  /**
   * Register a before-state loader for an entity type.
   * @throws {Error} if the entity type already has a loader — a duplicate is a
   *   wiring conflict and should be caught at boot.
   */
  register(entityType: string, loader: AuditBeforeStateLoader): void {
    if (this.loaders.has(entityType)) {
      throw new Error(`Audit before-state loader for entity "${entityType}" is already registered.`);
    }
    this.loaders.set(entityType, loader);
  }

  /** Whether a loader exists for the entity type. */
  has(entityType: string): boolean {
    return this.loaders.has(entityType);
  }

  /** Load the pre-mutation state; null for unregistered types or missing rows. */
  async load(entityType: string, id: string, tx: TxOrDb): Promise<Record<string, unknown> | null> {
    const loader = this.loaders.get(entityType);
    return loader ? loader.load(id, tx) : null;
  }
}

/**
 * Convert a DB row (snake_case keys) to the camelCase convention used by the
 * request-DTO `after` snapshots, so `before` and `after` diff field-by-field
 * (e.g. `name_i18n` ↔ `nameI18n`, `amount_minor` ↔ `amountMinor`).
 */
export function rowToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return out;
}

/**
 * Generic table-backed loader: reads the entity row by `id` inside the
 * tenant-bound transaction (`SELECT * FROM <table> WHERE id = $1 LIMIT 1`).
 * RLS restricts the read to the caller's org, so a row from another tenant
 * simply doesn't exist (fail closed). Returns null when the row is gone.
 *
 * Table names are static strings provided by module code (never client
 * input) and are quoted via `sql.identifier` — no injection surface.
 */
export function tableRowLoader(table: string): AuditBeforeStateLoader {
  return {
    async load(id, tx) {
      // TxOrDb unions the pool with `any`; cast to the typed Postgres client
      // for the generic execute (same pattern as the Drizzle repositories).
      const rows = await (tx as PostgresJsDatabase).execute<Record<string, unknown>>(
        sql`SELECT * FROM ${sql.identifier(table)} WHERE id = ${id} LIMIT 1`,
      );
      const row = rows[0];
      return row ? rowToCamel(row) : null;
    },
  };
}
