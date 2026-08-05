import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import type {
  ActivityListFilter,
  ContactListFilter,
  CompanyListFilter,
  CrmCompanyRecord,
  CrmPipelineRecord,
  CrmReadRepository,
  DealListFilter,
  DealListPage,
  DealSortBy,
  PageResult,
} from '../../application/ports/index.js';

/** Normalize a raw timestamptz (string | Date | null) to an ISO string or null. */
function isoOrNull(value: unknown): string | null {
  const date = fromDbDate(value);
  return date ? date.toISOString() : null;
}

/** Row shape for the paginated deals list (bigint/numeric → strings). */
type DealListRow = {
  id: string;
  title: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  company_id: string | null;
  value_amount_minor: string;
  value_currency: string;
  base_amount_minor: string | null;
  status: string;
  owner_user_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  contact_first_name: string | null;
  contact_last_name: string | null;
  company_name: string | null;
};

/** Row shape for `findDealById` (bigint/numeric columns come back as strings). */
type DealDetailRow = {
  id: string;
  title: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  company_id: string | null;
  value_amount_minor: string;
  value_currency: string;
  exchange_rate: string | null;
  base_amount_minor: string | null;
  expected_close_date: string | Date | null;
  status: string;
  closed_at: string | Date | null;
  lost_reason_code: string | null;
  owner_user_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

/** Row shape for `crm_deal_stage_history` reads. */
type StageHistoryRow = {
  id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  moved_at: string | Date;
  moved_by: string;
  duration_seconds: string;
};

@Injectable()
export class DrizzleCrmReadRepository implements CrmReadRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  private getDb(tx: TxOrDb): PostgresJsDatabase {
    return tx as PostgresJsDatabase;
  }

  async listContacts(filter: ContactListFilter, tx: TxOrDb): Promise<PageResult<Record<string, unknown>>> {
    const db = this.getDb(tx);
    const search = filter.search?.trim() ?? '';
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 12));
    const offset = (page - 1) * pageSize;

    // Most-recently added/edited first (updated_at DESC). RLS scopes the
    // whole query to the tenant; the company filter is a client-visible
    // narrowing, never a tenant bypass.
    const conditions = [
      sql`deleted_at IS NULL`,
      sql`(${search} = '' OR first_name ILIKE ${`%${search}%`} OR last_name ILIKE ${`%${search}%`}
           OR email::text ILIKE ${`%${search}%`} OR phone ILIKE ${`%${search}%`})`,
    ];
    if (filter.companyId) {
      conditions.push(sql`company_id = ${filter.companyId}`);
    }
    const where = sql.join(conditions, sql.raw(' AND '));

    const countRows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM crm_contacts WHERE ${where}`);
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id, first_name, last_name, email, phone, secondary_phone, company_id, owner_user_id,
             preferred_locale, preferred_currency
      FROM crm_contacts
      WHERE ${where}
      ORDER BY updated_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return {
      items: rows.map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone,
        secondaryPhone: row.secondary_phone,
        companyId: row.company_id,
        ownerUserId: row.owner_user_id,
        preferredLocale: row.preferred_locale,
        preferredCurrency: row.preferred_currency,
      })),
      total,
      page,
      pageSize,
    };
  }

  async listCompanies(filter: CompanyListFilter, tx: TxOrDb): Promise<PageResult<CrmCompanyRecord>> {
    const db = this.getDb(tx);
    const search = filter.search?.trim() ?? '';
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 12));
    const offset = (page - 1) * pageSize;

    const where = sql`deleted_at IS NULL
      AND (${search} = '' OR name ILIKE ${`%${search}%`} OR domain ILIKE ${`%${search}%`}
           OR industry ILIKE ${`%${search}%`})`;

    const countRows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM crm_companies WHERE ${where}`);
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT id, name, domain, industry, address, owner_user_id FROM crm_companies
      WHERE ${where}
      ORDER BY updated_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return {
      items: rows.map((row) => this.toCompany(row)),
      total,
      page,
      pageSize,
    };
  }

  async listDeals(filter: DealListFilter, tx: TxOrDb): Promise<DealListPage> {
    const db = this.getDb(tx);
    const search = filter.search?.trim() ?? '';
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 12));
    const offset = (page - 1) * pageSize;

    // RLS scopes the whole query to the tenant; the joins only resolve display
    // names, never widen the tenant scope.
    const conditions = [sql`d.deleted_at IS NULL`, sql`(${search} = '' OR d.title ILIKE ${`%${search}%`})`];
    if (filter.stageId) {
      conditions.push(sql`d.stage_id = ${filter.stageId}`);
    }
    if (filter.status) {
      conditions.push(sql`d.status = ${filter.status}`);
    }
    if (filter.fromDate) {
      conditions.push(sql`d.updated_at >= ${filter.fromDate}::date`);
    }
    if (filter.toDate) {
      // Inclusive: a deal touched any time on toDate still matches.
      conditions.push(sql`d.updated_at < (${filter.toDate}::date + interval '1 day')`);
    }
    const where = sql.join(conditions, sql.raw(' AND '));

    const countRows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM crm_deals d WHERE ${where}`);
    const total = Number(countRows[0]?.n ?? 0);

    // Exact value of the matching set in org-base minor units — independent of
    // the page-size clamp. A deal whose value currency equals the org base
    // stores base_amount_minor = NULL, so fall back to its own minor units
    // (DATA_MODEL §5 M1; never floating-point money).
    const sumRows = await db.execute<{ n: string | null }>(sql`
      SELECT SUM(
        CASE WHEN d.base_amount_minor IS NULL THEN d.value_amount_minor ELSE d.base_amount_minor END
      )::text AS n
      FROM crm_deals d
      WHERE ${where}
    `);
    const totalValueBaseMinor = sumRows[0]?.n ?? '0';

    // Sort keys are allow-listed here — never interpolated from client input
    // (the controller already rejects unknown values with 400; this is defence
    // in depth). `value` sorts by the org-base amount so every deal compares
    // on a common currency regardless of its own.
    const sortBy = filter.sortBy ?? 'updatedAt';
    const sortDir = filter.sortDir === 'asc' ? 'ASC' : 'DESC';
    const orderColumn: Record<DealSortBy, string> = {
      updatedAt: 'd.updated_at',
      createdAt: 'd.created_at',
      title: 'd.title',
      value: 'COALESCE(d.base_amount_minor, d.value_amount_minor)',
    };
    const orderBy = sql.raw(`${orderColumn[sortBy]} ${sortDir}`);

    const rows = await db.execute<DealListRow>(sql`
      SELECT d.id, d.title, d.pipeline_id, d.stage_id, d.contact_id, d.company_id,
             d.value_amount_minor, d.value_currency, d.base_amount_minor,
             d.status, d.owner_user_id, d.created_at, d.updated_at,
             c.first_name AS contact_first_name, c.last_name AS contact_last_name,
             co.name AS company_name
      FROM crm_deals d
      LEFT JOIN crm_contacts c ON c.id = d.contact_id
      LEFT JOIN crm_companies co ON co.id = d.company_id
      WHERE ${where}
      ORDER BY ${orderBy}, d.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return {
      items: rows.map((row) => {
        const contactName =
          row.contact_first_name !== null && row.contact_last_name !== null
            ? `${row.contact_first_name} ${row.contact_last_name}`
            : null;
        return {
          id: row.id,
          title: row.title,
          pipelineId: row.pipeline_id,
          stageId: row.stage_id,
          contactId: row.contact_id,
          companyId: row.company_id,
          contactName,
          companyName: row.company_name,
          value: { amountMinor: row.value_amount_minor, currency: row.value_currency },
          baseAmountMinor: row.base_amount_minor,
          status: row.status,
          ownerUserId: row.owner_user_id,
          createdAt: isoOrNull(row.created_at),
          updatedAt: isoOrNull(row.updated_at),
        };
      }),
      total,
      totalValueBaseMinor,
      page,
      pageSize,
    };
  }

  async listActivities(filter: ActivityListFilter, tx: TxOrDb): Promise<PageResult<Record<string, unknown>>> {
    const db = this.getDb(tx);
    const search = filter.search?.trim() ?? '';
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 12));
    const offset = (page - 1) * pageSize;

    // Incomplete first, then by due date (soonest first), then newest. RLS
    // scopes the whole query to the tenant; the LEFT JOINs only resolve
    // display names (related entity + deal stage) and never widen the tenant
    // scope — the `related_type` guard keeps joins null for unrelated rows.
    const conditions = [sql`a.deleted_at IS NULL`, sql`(${search} = '' OR a.subject ILIKE ${`%${search}%`})`];
    if (filter.assigneeUserId) {
      conditions.push(sql`a.assigned_to = ${filter.assigneeUserId}`);
    }
    if (filter.unassigned) {
      conditions.push(sql`a.assigned_to IS NULL`);
    }
    if (filter.completed === true) {
      conditions.push(sql`a.completed_at IS NOT NULL`);
    } else if (filter.completed === false) {
      conditions.push(sql`a.completed_at IS NULL`);
    }
    if (filter.fromDate) {
      // Undated activities stay visible in any date-filtered view — a task
      // with no due date shouldn't disappear just because the page defaults
      // to today's range.
      conditions.push(sql`(a.due_at IS NULL OR a.due_at >= ${filter.fromDate}::date)`);
    }
    if (filter.toDate) {
      // Inclusive: an activity due any time on toDate still matches.
      conditions.push(sql`(a.due_at IS NULL OR a.due_at < (${filter.toDate}::date + interval '1 day'))`);
    }
    const where = sql.join(conditions, sql.raw(' AND '));

    const countRows = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM crm_activities a WHERE ${where}`,
    );
    const total = Number(countRows[0]?.n ?? 0);

    const rows = await db.execute<Record<string, unknown>>(sql`
      SELECT a.id, a.type, a.subject, a.due_at, a.completed_at, a.related_type, a.related_id, a.assigned_to,
             c.first_name AS contact_first_name, c.last_name AS contact_last_name,
             co.name AS company_name,
             d.title AS deal_title, d.stage_id AS deal_stage_id,
             s.name_i18n AS deal_stage_name_i18n
      FROM crm_activities a
      LEFT JOIN crm_contacts c ON a.related_type = 'contact' AND c.id = a.related_id AND c.deleted_at IS NULL
      LEFT JOIN crm_companies co ON a.related_type = 'company' AND co.id = a.related_id AND co.deleted_at IS NULL
      LEFT JOIN crm_deals d ON a.related_type = 'deal' AND d.id = a.related_id AND d.deleted_at IS NULL
      LEFT JOIN crm_pipeline_stages s ON s.id = d.stage_id AND s.deleted_at IS NULL
      WHERE ${where}
      ORDER BY a.completed_at NULLS FIRST, a.due_at NULLS LAST, a.created_at DESC, a.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return {
      items: rows.map((row) => {
        // Resolve the display name of the related entity (contact / company /
        // deal), plus the deal's current stage for deal-related activities.
        let relatedName: string | null = null;
        if (row.related_type === 'contact') {
          relatedName =
            row.contact_first_name !== null && row.contact_last_name !== null
              ? `${row.contact_first_name as string} ${row.contact_last_name as string}`
              : null;
        } else if (row.related_type === 'company') {
          relatedName = (row.company_name as string | null) ?? null;
        } else if (row.related_type === 'deal') {
          relatedName = (row.deal_title as string | null) ?? null;
        }
        return {
          id: row.id,
          type: row.type,
          subject: row.subject,
          dueAt: row.due_at instanceof Date ? row.due_at.toISOString() : row.due_at,
          completedAt: row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at,
          relatedType: row.related_type,
          relatedId: row.related_id,
          assignedToUserId: row.assigned_to,
          relatedName,
          dealStageId: row.related_type === 'deal' ? ((row.deal_stage_id as string | null) ?? null) : null,
          dealStageNameI18n:
            row.related_type === 'deal' ? ((row.deal_stage_name_i18n as Record<string, string> | null) ?? null) : null,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async findContactById(id: string, tx: TxOrDb): Promise<Record<string, unknown> | undefined> {
    const rows = await this.getDb(tx).execute<Record<string, unknown>>(sql`
      SELECT id, first_name, last_name, email, phone, secondary_phone, company_id, owner_user_id,
             preferred_locale, preferred_currency, created_by, updated_by, created_at, updated_at
      FROM crm_contacts
      WHERE id = ${id} AND deleted_at IS NULL
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      phone: row.phone,
      secondaryPhone: row.secondary_phone,
      companyId: row.company_id,
      ownerUserId: row.owner_user_id,
      preferredLocale: row.preferred_locale,
      preferredCurrency: row.preferred_currency,
      createdByUserId: row.created_by,
      updatedByUserId: row.updated_by,
      createdAt: isoOrNull(row.created_at),
      updatedAt: isoOrNull(row.updated_at),
    };
  }

  async findCompanyById(id: string, tx: TxOrDb): Promise<CrmCompanyRecord | undefined> {
    const rows = await this.getDb(tx).execute<Record<string, unknown>>(sql`
      SELECT id, name, domain, industry, address, owner_user_id, created_by, updated_by, created_at, updated_at
      FROM crm_companies
      WHERE id = ${id} AND deleted_at IS NULL
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    return { ...this.toCompany(row), createdAt: isoOrNull(row.created_at), updatedAt: isoOrNull(row.updated_at) };
  }

  async findDealById(id: string, tx: TxOrDb): Promise<Record<string, unknown> | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<DealDetailRow>(sql`
      SELECT id, title, pipeline_id, stage_id, contact_id, company_id,
             value_amount_minor, value_currency, exchange_rate, base_amount_minor,
             expected_close_date, status, closed_at, lost_reason_code, owner_user_id,
             created_by, updated_by, created_at, updated_at
      FROM crm_deals
      WHERE id = ${id} AND deleted_at IS NULL
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    // CRM-6: the stage history is an append-only ledger; return it newest-first.
    const history = await db.execute<StageHistoryRow>(sql`
      SELECT id, from_stage_id, to_stage_id, moved_at, moved_by, duration_seconds
      FROM crm_deal_stage_history
      WHERE deal_id = ${id}
      ORDER BY moved_at DESC
    `);
    return {
      id: row.id,
      title: row.title,
      pipelineId: row.pipeline_id,
      stageId: row.stage_id,
      contactId: row.contact_id,
      companyId: row.company_id,
      value: { amountMinor: String(row.value_amount_minor), currency: row.value_currency },
      exchangeRate: row.exchange_rate === null ? null : Number(row.exchange_rate),
      baseAmountMinor: row.base_amount_minor === null ? null : String(row.base_amount_minor),
      expectedCloseDate: isoOrNull(row.expected_close_date),
      status: row.status,
      closedAt: isoOrNull(row.closed_at),
      lostReasonCode: row.lost_reason_code,
      ownerUserId: row.owner_user_id,
      createdByUserId: row.created_by,
      updatedByUserId: row.updated_by,
      createdAt: isoOrNull(row.created_at),
      updatedAt: isoOrNull(row.updated_at),
      stageHistory: history.map((entry) => ({
        id: entry.id,
        fromStageId: entry.from_stage_id,
        toStageId: entry.to_stage_id,
        movedAt: isoOrNull(entry.moved_at),
        movedBy: entry.moved_by,
        durationSeconds: Number(entry.duration_seconds),
      })),
    };
  }

  async findActivityById(id: string, tx: TxOrDb): Promise<Record<string, unknown> | undefined> {
    const rows = await this.getDb(tx).execute<Record<string, unknown>>(sql`
      SELECT id, type, subject, due_at, completed_at, related_type, related_id, assigned_to,
             created_by, updated_by, created_at, updated_at
      FROM crm_activities
      WHERE id = ${id} AND deleted_at IS NULL
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      type: row.type,
      subject: row.subject,
      dueAt: isoOrNull(row.due_at),
      completedAt: isoOrNull(row.completed_at),
      relatedType: row.related_type,
      relatedId: row.related_id,
      assignedToUserId: row.assigned_to,
      createdByUserId: row.created_by,
      updatedByUserId: row.updated_by,
      createdAt: isoOrNull(row.created_at),
      updatedAt: isoOrNull(row.updated_at),
    };
  }

  async getDefaultPipeline(tx: TxOrDb): Promise<CrmPipelineRecord | undefined> {
    const db = this.getDb(tx);
    const pipelines = await db.execute<Record<string, unknown>>(sql`
      SELECT id, name_i18n FROM crm_pipelines WHERE is_default AND deleted_at IS NULL LIMIT 1
    `);
    const pipeline = pipelines[0];
    if (!pipeline) return undefined;
    const stages = await db.execute<Record<string, unknown>>(sql`
      SELECT id, name_i18n, position, probability, is_won, is_lost FROM crm_pipeline_stages
      WHERE pipeline_id = ${pipeline.id as string} AND deleted_at IS NULL ORDER BY position
    `);
    return {
      id: pipeline.id as string,
      nameI18n: pipeline.name_i18n as Record<string, string>,
      stages: stages.map((stage) => ({
        id: stage.id as string,
        nameI18n: stage.name_i18n as Record<string, string>,
        position: Number(stage.position),
        probability: Number(stage.probability),
        isWon: stage.is_won as boolean,
        isLost: stage.is_lost as boolean,
      })),
    };
  }

  async insertCompany(input: CrmCompanyRecord & { organizationId: string }, tx: TxOrDb): Promise<CrmCompanyRecord> {
    // `address` is a jsonb column. Raw `sql` templates must serialize objects
    // explicitly — the postgres-js driver (as wrapped by drizzle) does NOT
    // JSON-stringify plain objects, and binding one crashes with
    // ERR_INVALID_ARG_TYPE (see db-date.ts for the same date identity override).
    const rows = await this.getDb(tx).execute<Record<string, unknown>>(sql`
      INSERT INTO crm_companies (id, organization_id, name, domain, industry, address, owner_user_id, created_by, updated_by)
      VALUES (${input.id}, ${input.organizationId}, ${input.name}, ${input.domain}, ${input.industry}, ${JSON.stringify(input.address ?? {})}::jsonb, ${input.ownerUserId ?? null}, ${input.createdByUserId ?? null}, ${input.updatedByUserId ?? null})
      RETURNING id, name, domain, industry, address, owner_user_id, created_by, updated_by
    `);
    return this.toCompany(rows[0] as Record<string, unknown>);
  }

  async updateCompany(id: string, input: Partial<CrmCompanyRecord>, tx: TxOrDb): Promise<CrmCompanyRecord | undefined> {
    const rows = await this.getDb(tx).execute<Record<string, unknown>>(sql`
      UPDATE crm_companies SET
        name = COALESCE(${input.name ?? null}, name),
        domain = CASE WHEN ${input.domain !== undefined} THEN ${input.domain ?? null} ELSE domain END,
        industry = CASE WHEN ${input.industry !== undefined} THEN ${input.industry ?? null} ELSE industry END,
        address = CASE WHEN ${input.address !== undefined} THEN ${JSON.stringify(input.address ?? {})}::jsonb ELSE address END,
        owner_user_id = CASE WHEN ${input.ownerUserId !== undefined} THEN ${input.ownerUserId ?? null} ELSE owner_user_id END,
        updated_by = CASE WHEN ${input.updatedByUserId !== undefined} THEN ${input.updatedByUserId ?? null} ELSE updated_by END
      WHERE id = ${id} AND deleted_at IS NULL
      RETURNING id, name, domain, industry, address, owner_user_id, created_by, updated_by
    `);
    return rows[0] ? this.toCompany(rows[0]) : undefined;
  }

  private toCompany(row: Record<string, unknown>): CrmCompanyRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      domain: (row.domain as string | null) ?? null,
      industry: (row.industry as string | null) ?? null,
      address: row.address as Record<string, unknown>,
      ownerUserId: (row.owner_user_id as string | null) ?? null,
      // Audit stamps are only present when the query selected the columns
      // (detail/insert/update) — list rows omit them rather than claim null.
      ...(row.created_by !== undefined ? { createdByUserId: (row.created_by as string | null) ?? null } : {}),
      ...(row.updated_by !== undefined ? { updatedByUserId: (row.updated_by as string | null) ?? null } : {}),
    };
  }
}
