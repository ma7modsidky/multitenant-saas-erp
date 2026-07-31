import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type InvitationData } from '../../domain/index.js';
import { type InvitationRepository } from '../../ports/index.js';

@Injectable()
export class DrizzleInvitationRepository implements InvitationRepository {
  private readonly table = sql.identifier('core_invitations');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  private rowToInvitation(row: Record<string, unknown>): InvitationData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      email: row.email as string,
      roleId: row.role_id as string,
      tokenHash: row.token_hash as string,
      expiresAt: row.expires_at as Date,
      acceptedAt: row.accepted_at as Date | null,
      revokedAt: row.revoked_at as Date | null,
      invitedBy: row.invited_by as string | null,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
      deletedAt: row.deleted_at as Date | null,
    };
  }

  async findById(id: string, tx?: TxOrDb): Promise<InvitationData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table} WHERE id = ${id} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToInvitation(row);
  }

  async findPendingByEmail(email: string, organizationId: string, tx?: TxOrDb): Promise<InvitationData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table}
          WHERE email = ${email} AND organization_id = ${organizationId}
          AND accepted_at IS NULL AND revoked_at IS NULL AND deleted_at IS NULL
          LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToInvitation(row);
  }

  async findByOrgId(organizationId: string, tx?: TxOrDb): Promise<InvitationData[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table} WHERE organization_id = ${organizationId} AND deleted_at IS NULL ORDER BY created_at DESC`,
    );
    return rows.map((r) => this.rowToInvitation(r));
  }

  async findByTokenHash(tokenHash: string, tx?: TxOrDb): Promise<InvitationData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.table} WHERE token_hash = ${tokenHash} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToInvitation(row);
  }

  async insert(data: InvitationData, tx?: TxOrDb): Promise<InvitationData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.table}
          (id, organization_id, email, role_id, token_hash, expires_at,
           invited_by, created_at, updated_at)
        VALUES
          (${data.id}, ${data.organizationId}, ${data.email}, ${data.roleId}, ${data.tokenHash}, ${data.expiresAt},
           ${data.invitedBy}, ${data.createdAt}, ${data.updatedAt})
        RETURNING *
      `,
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT RETURNING returned no rows');
    return this.rowToInvitation(row);
  }

  async update(id: string, data: Partial<InvitationData>, tx?: TxOrDb): Promise<InvitationData | undefined> {
    const db = this.getDb(tx);
    const fragments = [sql`updated_at = NOW()`];

    if (data.acceptedAt !== undefined) fragments.push(sql`accepted_at = ${data.acceptedAt}`);
    if (data.revokedAt !== undefined) fragments.push(sql`revoked_at = ${data.revokedAt}`);
    if (data.deletedAt !== undefined) fragments.push(sql`deleted_at = ${data.deletedAt}`);

    const setClause = sql.join(fragments, sql.raw(', '));
    const rows = await db.execute<Record<string, unknown>>(
      sql`UPDATE ${this.table} SET ${setClause} WHERE id = ${id} RETURNING *`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToInvitation(row);
  }
}
