import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type MembershipData } from '../../domain/index.js';
import { type MembershipRepository } from '../../ports/index.js';

@Injectable()
export class DrizzleMembershipRepository implements MembershipRepository {
  private readonly table = sql.identifier('core_memberships');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  private rowToMembership(row: Record<string, unknown>): MembershipData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      userId: row.user_id as string,
      roleId: row.role_id as string,
      status: row.status as MembershipData['status'],
      joinedAt: row.joined_at as Date,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
      createdBy: row.created_by as string | null,
      updatedBy: row.updated_by as string | null,
      deletedAt: row.deleted_at as Date | null,
    };
  }

  async findById(id: string, tx?: TxOrDb): Promise<MembershipData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table} WHERE id = ${id} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToMembership(row);
  }

  async findByUserAndOrg(userId: string, organizationId: string, tx?: TxOrDb): Promise<MembershipData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table} WHERE user_id = ${userId} AND organization_id = ${organizationId} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToMembership(row);
  }

  async findByUserId(userId: string, tx?: TxOrDb): Promise<MembershipData[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table} WHERE user_id = ${userId} AND deleted_at IS NULL`,
    );
    return rows.map((r) => this.rowToMembership(r));
  }

  async findOrgsByUserId(userId: string, tx?: TxOrDb): Promise<Array<{
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    roleId: string;
    status: string;
    joinedAt: Date;
  }>> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        SELECT m.organization_id, o.name AS organization_name, o.slug AS organization_slug,
               m.role_id, m.status, m.joined_at
        FROM core_memberships m
        JOIN core_organizations o ON o.id = m.organization_id
        WHERE m.user_id = ${userId} AND m.deleted_at IS NULL AND o.deleted_at IS NULL
        ORDER BY m.joined_at ASC
      `,
    );
    return rows.map((r) => ({
      organizationId: r.organization_id as string,
      organizationName: r.organization_name as string,
      organizationSlug: r.organization_slug as string,
      roleId: r.role_id as string,
      status: r.status as string,
      joinedAt: r.joined_at as Date,
    }));
  }

  async findByOrgId(organizationId: string, tx?: TxOrDb): Promise<MembershipData[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table} WHERE organization_id = ${organizationId} AND deleted_at IS NULL`,
    );
    return rows.map((r) => this.rowToMembership(r));
  }

  async countActiveByOrgId(organizationId: string, tx?: TxOrDb): Promise<number> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT COUNT(*) as count FROM ${this.table} WHERE organization_id = ${organizationId} AND status = 'active' AND deleted_at IS NULL`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async countByOrgIdAndRoleId(organizationId: string, roleId: string, tx?: TxOrDb): Promise<number> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT COUNT(*) as count FROM ${this.table} WHERE organization_id = ${organizationId} AND role_id = ${roleId} AND deleted_at IS NULL`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async insert(data: MembershipData, tx?: TxOrDb): Promise<MembershipData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.table}
          (id, organization_id, user_id, role_id, status, joined_at,
           created_at, updated_at, created_by, updated_by)
        VALUES
          (${data.id}, ${data.organizationId}, ${data.userId}, ${data.roleId}, ${data.status}, ${data.joinedAt},
           ${data.createdAt}, ${data.updatedAt}, ${data.createdBy}, ${data.updatedBy})
        RETURNING *
      `,
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT RETURNING returned no rows');
    return this.rowToMembership(row);
  }

  async update(id: string, data: Partial<MembershipData>, tx?: TxOrDb): Promise<MembershipData | undefined> {
    const db = this.getDb(tx);
    const fragments = [sql`updated_at = NOW()`];

    if (data.roleId !== undefined) fragments.push(sql`role_id = ${data.roleId}`);
    if (data.status !== undefined) fragments.push(sql`status = ${data.status}`);
    if (data.deletedAt !== undefined) fragments.push(sql`deleted_at = ${data.deletedAt}`);
    if (data.updatedBy !== undefined) fragments.push(sql`updated_by = ${data.updatedBy}`);

    const setClause = sql.join(fragments, sql.raw(', '));
    const rows = await db.execute<Record<string, unknown>>(
      sql`UPDATE ${this.table} SET ${setClause} WHERE id = ${id} RETURNING *`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToMembership(row);
  }
}
