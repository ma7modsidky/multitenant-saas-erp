import { Inject, Injectable } from '@nestjs/common';
import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  isNull,
  sql as drizzleSql,
} from 'drizzle-orm';
import { type PgColumn } from 'drizzle-orm/pg-core';
import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DRIZZLE_DB, type DrizzleDb } from './drizzle.provider.js';
import { TenantContext } from './tenant-context.js';

/**
 * Transaction-scoped database type.
 * When inside TransactionManager.run(), the callback can use this type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TxOrDb = PostgresJsDatabase | any;

/**
 * Generic pagination input.
 */
export interface PaginationInput {
  limit: number;
  offset?: number;
  cursor?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Generic pagination output.
 */
export interface PaginationOutput<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * RepositoryBase — abstract base class for all Drizzle repositories.
 *
 * Key design principles (from DATA_MODEL.md §2):
 *   1. No method takes `organizationId` as a filter argument.
 *      Organization ID is populated from `TenantContext`.
 *   2. `organization_id` on insert is populated from `TenantContext`,
 *      never from client input.
 *   3. All data operations accept an optional transaction-scoped db (`tx`).
 *      When inside TransactionManager.run(), pass the `tx` parameter.
 *   4. Soft-deleted rows are excluded by default.
 *
 * @typeParam TTable - The Drizzle table type
 */
@Injectable()
export abstract class RepositoryBase<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TTable extends Record<string, any>,
> {
  /**
   * Reference to the `organizationId` column for tenant isolation.
   * Must be set by subclasses in their constructor.
   */
  protected abstract readonly organizationIdColumn: PgColumn;

  /**
   * Reference to the `deletedAt` column for soft delete.
   * Optional — only needed for tables that support soft delete.
   */
  protected readonly deletedAtColumn?: PgColumn;

  constructor(
    @Inject(DRIZZLE_DB)
    protected readonly db: DrizzleDb,
    protected readonly table: TTable,
  ) {}

  /**
   * Get the appropriate database instance.
   * If a transaction-scoped db is provided, use it; otherwise use the pool.
   */
  protected getDb(tx?: TxOrDb): TxOrDb {
    return tx ?? this.db;
  }

  /**
   * Build the base WHERE conditions for tenant isolation and soft delete.
   */
  protected baseConditions(includeSoftDeleted = false): SQL[] {
    const conditions: SQL[] = [];

    // Auto-apply tenant isolation from TenantContext
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    // requireOrganizationId() throws a clear error if no tenant context is available
    // This is intentional — the repository should never be used outside a tenant context.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    conditions.push(eq(this.organizationIdColumn as never, TenantContext.requireOrganizationId() as never));

    // Exclude soft-deleted rows by default
    if (this.deletedAtColumn && !includeSoftDeleted) {
      conditions.push(isNull(this.deletedAtColumn as never));
    }

    return conditions;
  }

  /**
   * Find a record by its primary key (assumed to be `id`).
   *
   * @param id - The record ID
   * @param tx - Optional transaction-scoped db
   */
  async findById(
    id: string,
    tx?: TxOrDb,
  ): Promise<Record<string, unknown> | undefined> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const db = this.getDb(tx);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const columns = getTableColumns(this.table as never);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const [row] = await (db as PostgresJsDatabase)
      .select(columns)
      .from(this.table as never)
      .where(
        and(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          eq((this.table as never)['id'], id),
          ...this.baseConditions(),
        ),
      )
      .limit(1);

    return row as Record<string, unknown> | undefined;
  }

  /**
   * Find all records matching the optional conditions, with pagination.
   *
   * @param options - Query options (conditions, pagination, soft delete inclusion)
   * @param tx - Optional transaction-scoped db
   */
  async findMany(
    options: {
      conditions?: SQL[];
      pagination?: PaginationInput;
      includeSoftDeleted?: boolean;
    } = {},
    tx?: TxOrDb,
  ): Promise<PaginationOutput<Record<string, unknown>>> {
    const {
      conditions = [],
      pagination = { limit: 50 },
      includeSoftDeleted = false,
    } = options;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const db = this.getDb(tx);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const columns = getTableColumns(this.table as never);
    const whereClause = and(...this.baseConditions(includeSoftDeleted), ...conditions);

    // Get total count
    const [countResult] = await (db as PostgresJsDatabase)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      .select({ count: drizzleSql<number>`count(*)` })
      .from(this.table as never)
      .where(whereClause);

    const total = Number(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (countResult as { count: number } | undefined)?.count ?? 0,
    );

    // Apply sorting
    const orderByFn = pagination.sortOrder === 'desc' ? desc : asc;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const sortColumn = pagination.sortBy
      ? (this.table as never)[pagination.sortBy]
      : undefined;

    // Build query with optional sorting
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = (db as PostgresJsDatabase)
      .select(columns)
      .from(this.table as never)
      .where(whereClause)
      .limit(pagination.limit)
      .offset(pagination.offset ?? 0);

    if (sortColumn) {
      query = query.orderBy(orderByFn(sortColumn as never));
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const items = await query;

    return {
      items: items as Record<string, unknown>[],
      total,
      hasMore: (pagination.offset ?? 0) + pagination.limit < total,
    };
  }

  /**
   * Create a new record, auto-populating tenant and audit columns.
   *
   * @param data - The data to insert (without organization_id)
   * @param tx - Optional transaction-scoped db
   * @returns The created record
   */
  async create(
    data: Record<string, unknown>,
    tx?: TxOrDb,
  ): Promise<Record<string, unknown>> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const db = this.getDb(tx);
    const ctx = TenantContext.getCurrent();

    const insertData = {
      ...data,
      organizationId: ctx?.organizationId,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: ctx?.userId ?? null,
      updatedBy: ctx?.userId ?? null,
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const columns = getTableColumns(this.table as never);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    const result = await (db as PostgresJsDatabase)
      .insert(this.table as never)
      .values(insertData as never)
      .returning(columns);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const row = (result as Record<string, unknown>[] | undefined)?.[0];

    return row ?? {};
  }

  /**
   * Update a record by its primary key.
   *
   * @param id - The record ID
   * @param data - The data to update
   * @param tx - Optional transaction-scoped db
   * @returns The updated record, or undefined if not found
   */
  async update(
    id: string,
    data: Record<string, unknown>,
    tx?: TxOrDb,
  ): Promise<Record<string, unknown> | undefined> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const db = this.getDb(tx);
    const ctx = TenantContext.getCurrent();

    const updateData = {
      ...data,
      updatedAt: new Date(),
      updatedBy: ctx?.userId ?? null,
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const columns = getTableColumns(this.table as never);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    const result = await (db as PostgresJsDatabase)
      .update(this.table as never)
      .set(updateData as never)
      .where(
        and(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          eq((this.table as never)['id'], id),
          ...this.baseConditions(),
        ),
      )
      .returning(columns);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const row = (result as Record<string, unknown>[] | undefined)?.[0];

    return row;
  }

  /**
   * Soft-delete a record by its primary key.
   *
   * @param id - The record ID
   * @param tx - Optional transaction-scoped db
   */
  async softDelete(id: string, tx?: TxOrDb): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const db = this.getDb(tx);
    const ctx = TenantContext.getCurrent();

    if (!this.deletedAtColumn) {
      throw new Error(
        'Table does not support soft delete. ' +
          'Set the deletedAtColumn property in the repository subclass.',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    await (db as PostgresJsDatabase)
      .update(this.table as never)
      .set({ deletedAt: new Date(), updatedBy: ctx?.userId ?? null } as never)
      .where(
        and(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          eq((this.table as never)['id'], id),
          ...this.baseConditions(),
        ),
      );
  }

  /**
   * Permanently delete a record by its primary key.
   * Use only for append-only tables that cannot be soft-deleted.
   *
   * @param id - The record ID
   * @param tx - Optional transaction-scoped db
   */
  async hardDelete(id: string, tx?: TxOrDb): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const db = this.getDb(tx);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await (db as PostgresJsDatabase)
      .delete(this.table as never)
      .where(
        and(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          eq((this.table as never)['id'], id),
          ...this.baseConditions(),
        ),
      );
  }
}
