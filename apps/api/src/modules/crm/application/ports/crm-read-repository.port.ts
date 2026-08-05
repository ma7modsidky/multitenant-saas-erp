import type { TxOrDb } from '../../../../core/database/repository.base.js';

export interface CrmCompanyRecord {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  address: Record<string, unknown>;
  ownerUserId: string | null;
  /** Who created / last edited the company (set on insert/update; detail view). */
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  /** ISO timestamps (detail view only). */
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CrmPipelineRecord {
  id: string;
  nameI18n: Record<string, string>;
  stages: Array<{
    id: string;
    nameI18n: Record<string, string>;
    position: number;
    probability: number;
    isWon: boolean;
    isLost: boolean;
  }>;
}

/** Filter for the paginated contacts list. */
export interface ContactListFilter {
  search?: string;
  /** Restrict to contacts of one company. */
  companyId?: string;
  /** 1-indexed page. Default 1. */
  page?: number;
  /** Rows per page. Default 12, max 100. */
  pageSize?: number;
}

/** Filter for the paginated companies list. */
export interface CompanyListFilter {
  search?: string;
  /** 1-indexed page. Default 1. */
  page?: number;
  /** Rows per page. Default 12, max 100. */
  pageSize?: number;
}

/** Sort key for the deals list. `value` sorts by the org-base amount. */
export type DealSortBy = 'updatedAt' | 'createdAt' | 'title' | 'value';

export type SortDirection = 'asc' | 'desc';

/** Filter for the paginated deals list. */
export interface DealListFilter {
  /** Matches deal title (case-insensitive substring). */
  search?: string;
  /** Restrict to one pipeline stage (per-column board queries). */
  stageId?: string;
  /** Restrict by deal status (table view filter). */
  status?: 'open' | 'won' | 'lost';
  /**
   * Inclusive lower bound on `updated_at` (ISO date `YYYY-MM-DD`). Only deals
   * touched on or after this day match.
   */
  fromDate?: string;
  /**
   * Inclusive upper bound on `updated_at` (ISO date `YYYY-MM-DD`). Only deals
   * touched on or before this day match.
   */
  toDate?: string;
  /** Sort key. Default `updatedAt` (most recently touched first). */
  sortBy?: DealSortBy;
  /** Sort direction. Default `desc`. */
  sortDir?: SortDirection;
  /** 1-indexed page. Default 1. */
  page?: number;
  /** Rows per page. Default 12, max 100. */
  pageSize?: number;
}

/**
 * A page of deals plus the exact value of the matching set, summed in the
 * org base currency (server-side, unaffected by the page size clamp).
 * Deals whose value currency equals the org base have a NULL
 * `base_amount_minor` — the sum uses the stored base amount when present and
 * the deal's own minor units otherwise. Zero minor units when no rows match.
 */
export interface DealListPage extends PageResult<Record<string, unknown>> {
  totalValueBaseMinor: string;
}

/** Filter for the paginated activities list. */
export interface ActivityListFilter {
  /** Matches activity subject (case-insensitive substring). */
  search?: string;
  /**
   * Inclusive lower bound on `due_at` (ISO date `YYYY-MM-DD`). Only activities
   * due on or after this day match.
   */
  fromDate?: string;
  /**
   * Inclusive upper bound on `due_at` (ISO date `YYYY-MM-DD`). Only activities
   * due on or before this day match.
   */
  toDate?: string;
  /**
   * Restrict to activities assigned to this user (CRM-14). RLS keeps the
   * scope tenant-local; this is a client-visible narrowing, never a bypass.
   */
  assigneeUserId?: string;
  /**
   * Restrict to activities with no assignee (`assigned_to IS NULL`).
   * Mutually exclusive with `assigneeUserId` in practice — the UI picks one.
   */
  unassigned?: boolean;
  /**
   * Restrict by completion: `true` = completed only, `false` = open only.
   * Absent = both.
   */
  completed?: boolean;
  /** 1-indexed page. Default 1. */
  page?: number;
  /** Rows per page. Default 12, max 100. */
  pageSize?: number;
}

/** A page of results with the total matching row count (for pagination UI). */
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CrmReadRepository {
  listContacts(filter: ContactListFilter, tx: TxOrDb): Promise<PageResult<Record<string, unknown>>>;
  listCompanies(filter: CompanyListFilter, tx: TxOrDb): Promise<PageResult<CrmCompanyRecord>>;
  listDeals(filter: DealListFilter, tx: TxOrDb): Promise<DealListPage>;
  listActivities(filter: ActivityListFilter, tx: TxOrDb): Promise<PageResult<Record<string, unknown>>>;
  getDefaultPipeline(tx: TxOrDb): Promise<CrmPipelineRecord | undefined>;
  /** Find a non-deleted contact by id (detail view). */
  findContactById(id: string, tx: TxOrDb): Promise<Record<string, unknown> | undefined>;
  /** Find a non-deleted company by id (detail view). */
  findCompanyById(id: string, tx: TxOrDb): Promise<CrmCompanyRecord | undefined>;
  /** Find a non-deleted deal by id with its append-only stage history (detail view). */
  findDealById(id: string, tx: TxOrDb): Promise<Record<string, unknown> | undefined>;
  /** Find a non-deleted activity by id (detail view). */
  findActivityById(id: string, tx: TxOrDb): Promise<Record<string, unknown> | undefined>;
  insertCompany(input: CrmCompanyRecord & { organizationId: string }, tx: TxOrDb): Promise<CrmCompanyRecord>;
  updateCompany(id: string, input: Partial<CrmCompanyRecord>, tx: TxOrDb): Promise<CrmCompanyRecord | undefined>;
}

export const CRM_READ_REPOSITORY = Symbol('CRM_READ_REPOSITORY');
