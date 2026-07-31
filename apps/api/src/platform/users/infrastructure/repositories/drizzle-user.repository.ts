import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { User, type UserData } from '../../domain/index.js';
import { type UserRepository } from '../../ports/index.js';

/**
 * Drizzle overrides postgres.js date serializers with identity functions
 * (driver.js), so JS Date values must be passed to raw sql`` templates as
 * ISO strings.
 */
function toDbDate(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toISOString();
}

/**
 * DrizzleUserRepository — Drizzle implementation of UserRepository.
 *
 * Uses raw SQL with sql`` tag for table references since Drizzle schema
 * files haven't been generated for core_users yet.
 * snake_case DB columns are mapped to camelCase domain objects.
 */
@Injectable()
export class DrizzleUserRepository implements UserRepository {
  private readonly table = sql.identifier('core_users');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async findById(id: string, tx?: TxOrDb): Promise<UserData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table} WHERE id = ${id} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToUser(row);
  }

  async findByEmail(email: string, tx?: TxOrDb): Promise<UserData | undefined> {
    const db = this.getDb(tx);
    const normalizedEmail = User.normalizeEmail(email);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table} WHERE email = ${normalizedEmail} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToUser(row);
  }

  async isEmailTaken(email: string, excludeUserId?: string, tx?: TxOrDb): Promise<boolean> {
    const db = this.getDb(tx);
    const normalizedEmail = User.normalizeEmail(email);

    const condition = excludeUserId
      ? sql`email = ${normalizedEmail} AND id != ${excludeUserId}`
      : sql`email = ${normalizedEmail}`;

    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT id FROM ${this.table} WHERE ${condition} LIMIT 1`,
    );
    return rows.length > 0;
  }

  async insert(data: UserData, tx?: TxOrDb): Promise<UserData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.table}
          (id, email, password_hash, name, preferred_locale,
           email_verified_at, failed_login_attempts, locked_until,
           created_at, updated_at)
        VALUES
          (${data.id}, ${data.email}, ${data.passwordHash}, ${data.name}, ${data.preferredLocale},
           ${toDbDate(data.emailVerifiedAt)}, ${data.failedLoginAttempts}, ${toDbDate(data.lockedUntil)},
           ${toDbDate(data.createdAt)}, ${toDbDate(data.updatedAt)})
        RETURNING *
      `,
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT RETURNING returned no rows');
    return this.rowToUser(row);
  }

  async update(id: string, data: Partial<UserData>, tx?: TxOrDb): Promise<UserData | undefined> {
    const db = this.getDb(tx);
    const setFragments: ReturnType<typeof sql>[] = [sql`updated_at = NOW()`];

    if (data.passwordHash !== undefined) setFragments.push(sql`password_hash = ${data.passwordHash}`);
    if (data.name !== undefined) setFragments.push(sql`name = ${data.name}`);
    if (data.preferredLocale !== undefined) setFragments.push(sql`preferred_locale = ${data.preferredLocale}`);
    if (data.emailVerifiedAt !== undefined) setFragments.push(sql`email_verified_at = ${toDbDate(data.emailVerifiedAt)}`);
    if (data.failedLoginAttempts !== undefined) setFragments.push(sql`failed_login_attempts = ${data.failedLoginAttempts}`);
    if (data.lockedUntil !== undefined) setFragments.push(sql`locked_until = ${toDbDate(data.lockedUntil)}`);

    const setClause = sql.join(setFragments, sql.raw(', '));
    const rows = await db.execute<Record<string, unknown>>(
      sql`UPDATE ${this.table} SET ${setClause} WHERE id = ${id} RETURNING *`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToUser(row);
  }

  // ─── Row mapping ────────────────────────────────────────────────────────

  private rowToUser(row: Record<string, unknown>): UserData {
    return {
      id: row.id as string,
      email: row.email as string,
      passwordHash: row.password_hash as string,
      name: row.name as string,
      preferredLocale: row.preferred_locale as string | null,
      emailVerifiedAt: fromDbDate(row.email_verified_at),
      failedLoginAttempts: Number(row.failed_login_attempts ?? 0),
      lockedUntil: fromDbDate(row.locked_until),
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
    };
  }
}

/**
 * Drizzle's transparent parser returns timestamptz values as strings, so
 * normalise them back to Date instances.
 */
function fromDbDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  return value instanceof Date ? value : new Date(value as string);
}
