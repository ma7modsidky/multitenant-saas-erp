import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type RoleData } from '../../domain/index.js';
import { type RoleRepository } from '../../ports/index.js';

@Injectable()
export class DrizzleRoleRepository implements RoleRepository {
  private readonly rolesTable = sql.identifier('core_roles');
  private readonly rolePermsTable = sql.identifier('core_role_permissions');
  private readonly permsTable = sql.identifier('core_permissions');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  private rowToRole(row: Record<string, unknown>): RoleData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      key: row.key as string,
      nameI18n: row.name_i18n as Record<string, string>,
      description: row.description as string | null,
      isSystem: row.is_system as boolean,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      createdBy: row.created_by as string | null,
      updatedBy: row.updated_by as string | null,
      deletedAt: fromDbDate(row.deleted_at),
    };
  }

  async findById(id: string, tx?: TxOrDb): Promise<RoleData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.rolesTable} WHERE id = ${id} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToRole(row);
  }

  async findByKey(organizationId: string, key: string, tx?: TxOrDb): Promise<RoleData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.rolesTable} WHERE organization_id = ${organizationId} AND key = ${key} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToRole(row);
  }

  async findByOrgId(organizationId: string, tx?: TxOrDb): Promise<RoleData[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.rolesTable} WHERE organization_id = ${organizationId} AND deleted_at IS NULL ORDER BY is_system DESC, created_at ASC`,
    );
    return rows.map((r) => this.rowToRole(r));
  }

  async insert(data: RoleData, tx?: TxOrDb): Promise<RoleData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.rolesTable}
          (id, organization_id, key, name_i18n, description, is_system,
           created_at, updated_at, created_by, updated_by)
        VALUES
          (${data.id}, ${data.organizationId}, ${data.key}, ${JSON.stringify(data.nameI18n)}::jsonb,
           ${data.description}, ${data.isSystem},
           ${toDbDate(data.createdAt)}, ${toDbDate(data.updatedAt)}, ${data.createdBy}, ${data.updatedBy})
        RETURNING *
      `,
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT RETURNING returned no rows');
    return this.rowToRole(row);
  }

  async update(id: string, data: Partial<RoleData>, tx?: TxOrDb): Promise<RoleData | undefined> {
    const db = this.getDb(tx);
    const fragments = [sql`updated_at = NOW()`];

    if (data.nameI18n !== undefined) fragments.push(sql`name_i18n = ${JSON.stringify(data.nameI18n)}::jsonb`);
    if (data.description !== undefined) fragments.push(sql`description = ${data.description}`);
    if (data.updatedBy !== undefined) fragments.push(sql`updated_by = ${data.updatedBy}`);
    if (data.deletedAt !== undefined) fragments.push(sql`deleted_at = ${toDbDate(data.deletedAt)}`);
    if (data.isSystem !== undefined) fragments.push(sql`is_system = ${data.isSystem}`);

    // Build the SET clause using the fragment for name_i18n separately to handle jsonb
    const setClause = sql.join(fragments, sql.raw(', '));
    const rows = await db.execute<Record<string, unknown>>(
      sql`UPDATE ${this.rolesTable} SET ${setClause} WHERE id = ${id} RETURNING *`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToRole(row);
  }

  async softDelete(id: string, updatedBy?: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(
      sql`UPDATE ${this.rolesTable} SET deleted_at = NOW(), updated_at = NOW(), updated_by = ${updatedBy ?? null} WHERE id = ${id}`,
    );
  }

  async countMembersByRoleId(organizationId: string, roleId: string, tx?: TxOrDb): Promise<number> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT COUNT(*) as count FROM core_memberships WHERE organization_id = ${organizationId} AND role_id = ${roleId} AND deleted_at IS NULL`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  // ─── Permissions ────────────────────────────────────────────────────────

  async getPermissions(roleId: string, tx?: TxOrDb): Promise<string[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT permission_key FROM ${this.rolePermsTable} WHERE role_id = ${roleId} ORDER BY permission_key`,
    );
    return rows.map((r) => r.permission_key as string);
  }

  async setPermissions(roleId: string, permissionKeys: string[], createdBy: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    // Delete existing permissions
    await db.execute(sql`DELETE FROM ${this.rolePermsTable} WHERE role_id = ${roleId}`);
    // Insert new permissions
    for (const key of permissionKeys) {
      await db.execute(
        sql`
          INSERT INTO ${this.rolePermsTable}
            (id, organization_id, role_id, permission_key, created_by)
          VALUES
            (gen_random_uuid(), (SELECT organization_id FROM ${this.rolesTable} WHERE id = ${roleId}),
             ${roleId}, ${key}, ${createdBy})
        `,
      );
    }
  }

  async getAllRegisteredPermissions(_organizationId: string, tx?: TxOrDb): Promise<string[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(sql`SELECT key FROM ${this.permsTable} ORDER BY key`);
    return rows.map((r) => r.key as string);
  }
}
