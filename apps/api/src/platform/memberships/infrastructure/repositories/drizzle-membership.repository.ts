import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
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
      joinedAt: fromDbDate(row.joined_at) as Date,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      createdBy: row.created_by as string | null,
      updatedBy: row.updated_by as string | null,
      deletedAt: fromDbDate(row.deleted_at),
    };
  }

  async findById(id: string, tx?: TxOrDb): Promise<MembershipData | undefined> {
    const db = this.getDb(tx);
    // Join core_roles so AUTHZ-1 (last-OWNER protection) can be enforced in
    // the use cases — the role key tells us whether the member holds OWNER.
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT m.*, r.key AS role_key
          FROM ${this.table} m
          LEFT JOIN core_roles r ON r.id = m.role_id
          WHERE m.id = ${id} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    const membership = this.rowToMembership(row);
    const roleKey = row.role_key as string | undefined;
    // exactOptionalPropertyTypes: never set an optional property to `undefined`
    // explicitly — spread it in only when the join produced a value.
    return roleKey === undefined ? membership : { ...membership, roleKey };
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

  async findOrgsByUserId(
    userId: string,
    tx?: TxOrDb,
  ): Promise<
    Array<{
      organizationId: string;
      organizationName: string;
      organizationSlug: string;
      roleId: string;
      status: string;
      organizationStatus: string;
      joinedAt: Date;
    }>
  > {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        SELECT m.organization_id, o.name AS organization_name, o.slug AS organization_slug,
               m.role_id, m.status, o.status AS organization_status, m.joined_at
        FROM core_memberships m
        JOIN core_organizations o ON o.id = m.organization_id
        WHERE m.user_id = ${userId} AND m.deleted_at IS NULL AND o.status IN ('active', 'pending_deletion')
        ORDER BY m.joined_at ASC
      `,
    );
    return rows.map((r) => ({
      organizationId: r.organization_id as string,
      organizationName: r.organization_name as string,
      organizationSlug: r.organization_slug as string,
      roleId: r.role_id as string,
      status: r.status as string,
      organizationStatus: r.organization_status as string,
      joinedAt: fromDbDate(r.joined_at) as Date,
    }));
  }

  async findByOrgId(organizationId: string, tx?: TxOrDb): Promise<MembershipData[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table} WHERE organization_id = ${organizationId} AND deleted_at IS NULL`,
    );
    return rows.map((r) => this.rowToMembership(r));
  }

  async findMembersByOrgId(
    organizationId: string,
    tx?: TxOrDb,
  ): Promise<Array<MembershipData & { userName: string; userEmail: string }>> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        SELECT m.*, u.name AS user_name, u.email AS user_email
        FROM core_memberships m
        JOIN core_users u ON u.id = m.user_id
        WHERE m.organization_id = ${organizationId} AND m.deleted_at IS NULL
        ORDER BY m.joined_at ASC
      `,
    );
    return rows.map((r) => ({
      ...this.rowToMembership(r),
      userName: r.user_name as string,
      userEmail: r.user_email as string,
    }));
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

  async resolveRolePermissions(
    organizationId: string,
    roleId: string,
    tx?: TxOrDb,
  ): Promise<{ roleKey: string; isSystem: boolean; permissions: string[] } | undefined> {
    const db = this.getDb(tx);

    // core_roles is RLS-protected; the caller MUST run this inside the
    // tenant-bound transaction (txManager.run) or it fails closed to zero rows.
    const [roleRow] = await db.execute<Record<string, unknown>>(
      sql`SELECT key, is_system FROM core_roles WHERE id = ${roleId} AND organization_id = ${organizationId} AND deleted_at IS NULL LIMIT 1`,
    );
    if (!roleRow) return undefined;

    const roleKey = roleRow.key as string;
    const isSystem = roleRow.is_system === true;

    // System-role permissions are code-defined (SYSTEM_ROLE_PERMISSIONS in the
    // roles domain); only custom roles persist rows in core_role_permissions.
    if (isSystem) {
      return { roleKey, isSystem, permissions: [] };
    }

    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT permission_key FROM core_role_permissions WHERE role_id = ${roleId} AND organization_id = ${organizationId}`,
    );
    return {
      roleKey,
      isSystem,
      permissions: rows.map((r) => r.permission_key as string),
    };
  }

  async insert(data: MembershipData, tx?: TxOrDb): Promise<MembershipData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.table}
          (id, organization_id, user_id, role_id, status, joined_at,
           created_at, updated_at, created_by, updated_by)
        VALUES
          (${data.id}, ${data.organizationId}, ${data.userId}, ${data.roleId}, ${data.status}, ${toDbDate(data.joinedAt)},
           ${toDbDate(data.createdAt)}, ${toDbDate(data.updatedAt)}, ${data.createdBy}, ${data.updatedBy})
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
    if (data.deletedAt !== undefined) fragments.push(sql`deleted_at = ${toDbDate(data.deletedAt)}`);
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
