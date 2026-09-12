import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { TEAM_REPOSITORY, type TeamRepository } from '../../ports/team-repository.port.js';
import { type TeamData } from '../../domain/team.entity.js';

/**
 * DrizzleTeamRepository — raw-SQL persistence for core_teams /
 * core_team_memberships (same style as DrizzleContactRepository).
 *
 * RLS scopes org-scoped queries to the tenant (fail-closed).
 */
@Injectable()
export class DrizzleTeamRepository implements TeamRepository {
  private readonly teams = sql.identifier('core_teams');
  private readonly memberships = sql.identifier('core_team_memberships');

  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async listWithMembers(organizationId: string, tx?: TxOrDb): Promise<Array<TeamData & { memberUserIds: string[] }>> {
    const db = this.getDb(tx);
    const teamRows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.teams} WHERE organization_id = ${organizationId} AND deleted_at IS NULL ORDER BY name ASC`,
    );
    const memberRows = await db.execute<{ team_id: string; user_id: string }>(
      sql`SELECT team_id, user_id FROM ${this.memberships}
          WHERE organization_id = ${organizationId} AND deleted_at IS NULL`,
    );
    return teamRows.map((row) => ({
      ...this.rowToTeam(row),
      memberUserIds: memberRows.filter((m) => m.team_id === row.id).map((m) => m.user_id),
    }));
  }

  async findById(id: string, tx?: TxOrDb): Promise<TeamData | undefined> {
    const rows = await this.getDb(tx).execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.teams} WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    return row ? this.rowToTeam(row) : undefined;
  }

  async findByName(organizationId: string, name: string, tx?: TxOrDb): Promise<TeamData | undefined> {
    const rows = await this.getDb(tx).execute<Record<string, unknown>>(
      sql`SELECT * FROM ${this.teams} WHERE organization_id = ${organizationId} AND name = ${name} AND deleted_at IS NULL LIMIT 1`,
    );
    const row = rows[0];
    return row ? this.rowToTeam(row) : undefined;
  }

  async insert(data: TeamData, tx?: TxOrDb): Promise<TeamData> {
    const rows = await this.getDb(tx).execute<Record<string, unknown>>(
      sql`
        INSERT INTO ${this.teams}
          (id, organization_id, name, description, leader_user_id, created_at, updated_at, created_by, updated_by)
        VALUES
          (${data.id}, ${data.organizationId}, ${data.name}, ${data.description}, ${data.leaderUserId},
           ${toDbDate(data.createdAt)}, ${toDbDate(data.updatedAt)}, ${data.createdBy}, ${data.updatedBy})
        RETURNING *
      `,
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT RETURNING returned no rows');
    return this.rowToTeam(row);
  }

  async update(id: string, data: Partial<TeamData>, tx?: TxOrDb): Promise<TeamData | undefined> {
    const fragments: ReturnType<typeof sql>[] = [sql`updated_at = NOW()`];
    if (data.name !== undefined) fragments.push(sql`name = ${data.name}`);
    if (data.description !== undefined) fragments.push(sql`description = ${data.description}`);
    if (data.leaderUserId !== undefined) fragments.push(sql`leader_user_id = ${data.leaderUserId}`);
    if (data.updatedBy !== undefined) fragments.push(sql`updated_by = ${data.updatedBy}`);

    const setClause = sql.join(fragments, sql.raw(', '));
    const rows = await this.getDb(tx).execute<Record<string, unknown>>(
      sql`UPDATE ${this.teams} SET ${setClause} WHERE id = ${id} AND deleted_at IS NULL RETURNING *`,
    );
    const row = rows[0];
    return row ? this.rowToTeam(row) : undefined;
  }

  async softDelete(id: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`UPDATE ${this.teams} SET deleted_at = NOW() WHERE id = ${id} AND deleted_at IS NULL`);
    await db.execute(
      sql`UPDATE ${this.memberships} SET deleted_at = NOW() WHERE team_id = ${id} AND deleted_at IS NULL`,
    );
  }

  async addMember(
    input: { organizationId: string; teamId: string; userId: string; actorUserId: string },
    tx?: TxOrDb,
  ): Promise<void> {
    if (await this.hasMember(input.organizationId, input.teamId, input.userId, tx)) return;
    await this.getDb(tx).execute(sql`
      INSERT INTO ${this.memberships}
        (id, organization_id, team_id, user_id, created_at, updated_at, created_by, updated_by)
      VALUES
        (gen_random_uuid(), ${input.organizationId}, ${input.teamId}, ${input.userId},
         NOW(), NOW(), ${input.actorUserId}, ${input.actorUserId})
    `);
  }

  async removeMember(input: { organizationId: string; teamId: string; userId: string }, tx?: TxOrDb): Promise<void> {
    await this.getDb(tx).execute(sql`
      UPDATE ${this.memberships} SET deleted_at = NOW()
      WHERE organization_id = ${input.organizationId} AND team_id = ${input.teamId}
        AND user_id = ${input.userId} AND deleted_at IS NULL
    `);
  }

  async listTeamIdsForUser(organizationId: string, userId: string, tx?: TxOrDb): Promise<string[]> {
    // Include both explicit memberships and teams led (leader is implicitly member for scope)
    const rows = await this.getDb(tx).execute<{ team_id: string }>(sql`
      SELECT m.team_id FROM ${this.memberships} m
      JOIN ${this.teams} t ON t.id = m.team_id AND t.deleted_at IS NULL
      WHERE m.organization_id = ${organizationId} AND m.user_id = ${userId} AND m.deleted_at IS NULL
      UNION
      SELECT id AS team_id FROM ${this.teams}
      WHERE organization_id = ${organizationId} AND leader_user_id = ${userId} AND deleted_at IS NULL
    `);
    return [...new Set(rows.map((row) => row.team_id))];
  }

  async listLeaderTeamIds(organizationId: string, userId: string, tx?: TxOrDb): Promise<string[]> {
    const rows = await this.getDb(tx).execute<{ id: string }>(sql`
      SELECT id FROM ${this.teams}
      WHERE organization_id = ${organizationId} AND leader_user_id = ${userId} AND deleted_at IS NULL
    `);
    return rows.map((row) => row.id);
  }

  async listTeamMemberUserIds(organizationId: string, teamId: string, tx?: TxOrDb): Promise<string[]> {
    const rows = await this.getDb(tx).execute<{ user_id: string }>(sql`
      SELECT user_id FROM ${this.memberships}
      WHERE organization_id = ${organizationId} AND team_id = ${teamId}
        AND user_id IN (SELECT id FROM core_users) AND deleted_at IS NULL
    `);
    return rows.map((row) => row.user_id);
  }
  async hasMember(organizationId: string, teamId: string, userId: string, tx?: TxOrDb): Promise<boolean> {
    const rows = await this.getDb(tx).execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM ${this.memberships}
      WHERE organization_id = ${organizationId} AND team_id = ${teamId}
        AND user_id = ${userId} AND deleted_at IS NULL
      UNION ALL
      SELECT 1 AS n FROM ${this.teams}
      WHERE id = ${teamId} AND organization_id = ${organizationId}
        AND leader_user_id = ${userId} AND deleted_at IS NULL
      LIMIT 1
    `);
    return Number(rows[0]?.n ?? 0) > 0;
  }

  private rowToTeam(row: Record<string, unknown>): TeamData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      leaderUserId: (row.leader_user_id as string | null) ?? null,
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
      createdBy: (row.created_by as string | null) ?? null,
      updatedBy: (row.updated_by as string | null) ?? null,
      deletedAt: fromDbDate(row.deleted_at),
    };
  }
}
