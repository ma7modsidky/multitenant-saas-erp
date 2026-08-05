import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type ContactRepository } from '../../application/ports/index.js';
import { type ContactData } from '../../domain/index.js';

/**
 * DrizzleContactRepository — Drizzle implementation of ContactRepository.
 *
 * RLS scopes all queries to the current organization (fail-closed), so no
 * manual organization_id filters are used in feature code (hard rule #2).
 */
@Injectable()
export class DrizzleContactRepository implements ContactRepository {
  private readonly table = sql.identifier('crm_contacts');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async findById(id: string, tx?: TxOrDb): Promise<ContactData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table} WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToContact(row);
  }

  async findByEmail(email: string, tx?: TxOrDb): Promise<ContactData | undefined> {
    const db = this.getDb(tx);
    // citext column — comparison is case-insensitive (CRM-2).
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table} WHERE email = ${email} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToContact(row);
  }

  async insert(data: ContactData, tx?: TxOrDb): Promise<ContactData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.table}
          (id, organization_id, first_name, last_name, email, phone, secondary_phone, company_id,
           owner_user_id, preferred_locale, preferred_currency,
           created_at, updated_at, created_by, updated_by)
        VALUES
          (${data.id}, ${data.organizationId}, ${data.firstName}, ${data.lastName},
           ${data.email}, ${data.phone}, ${data.secondaryPhone}, ${data.companyId},
           ${data.ownerUserId}, ${data.preferredLocale}, ${data.preferredCurrency},
           ${toDbDate(data.createdAt)}, ${toDbDate(data.updatedAt)}, ${data.createdBy}, ${data.updatedBy})
        RETURNING *
      `,
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT RETURNING returned no rows');
    return this.rowToContact(row);
  }

  async update(id: string, data: Partial<ContactData>, tx?: TxOrDb): Promise<ContactData | undefined> {
    const db = this.getDb(tx);
    const setFragments: ReturnType<typeof sql>[] = [sql`updated_at = NOW()`];

    if (data.firstName !== undefined) setFragments.push(sql`first_name = ${data.firstName}`);
    if (data.lastName !== undefined) setFragments.push(sql`last_name = ${data.lastName}`);
    if (data.email !== undefined) setFragments.push(sql`email = ${data.email}`);
    if (data.phone !== undefined) setFragments.push(sql`phone = ${data.phone}`);
    if (data.secondaryPhone !== undefined) setFragments.push(sql`secondary_phone = ${data.secondaryPhone}`);
    if (data.companyId !== undefined) setFragments.push(sql`company_id = ${data.companyId}`);
    if (data.ownerUserId !== undefined) setFragments.push(sql`owner_user_id = ${data.ownerUserId}`);
    if (data.preferredLocale !== undefined) setFragments.push(sql`preferred_locale = ${data.preferredLocale}`);
    if (data.preferredCurrency !== undefined) {
      setFragments.push(sql`preferred_currency = ${data.preferredCurrency}`);
    }
    if (data.updatedBy !== undefined) setFragments.push(sql`updated_by = ${data.updatedBy}`);

    const setClause = sql.join(setFragments, sql.raw(', '));
    const rows = await db.execute<Record<string, unknown>>(
      sql`UPDATE ${this.table} SET ${setClause} WHERE id = ${id} AND deleted_at IS NULL RETURNING *`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToContact(row);
  }

  async softDelete(id: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`UPDATE ${this.table} SET deleted_at = NOW() WHERE id = ${id} AND deleted_at IS NULL`);
  }

  private rowToContact(row: Record<string, unknown>): ContactData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      companyId: (row.company_id as string | null) ?? null,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      email: (row.email as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      secondaryPhone: (row.secondary_phone as string | null) ?? null,
      ownerUserId: (row.owner_user_id as string | null) ?? null,
      preferredLocale: (row.preferred_locale as string | null) ?? null,
      preferredCurrency: (row.preferred_currency as string | null) ?? null,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      createdBy: (row.created_by as string | null) ?? null,
      updatedBy: (row.updated_by as string | null) ?? null,
      deletedAt: fromDbDate(row.deleted_at),
    };
  }
}
