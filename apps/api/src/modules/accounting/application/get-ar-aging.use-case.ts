import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ACCOUNTING_REPOSITORY, type AccountingRepository, type AgingInvoiceRow } from './ports/index.js';

/** Aging buckets (days past due): current, 1–30, 31–60, 61–90, 90+. */
export type AgingBucketKey = 'current' | '1_30' | '31_60' | '61_90' | '90_plus';

/** One open invoice in the aging report with its balance due. */
export interface AgingInvoice {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  /** Outstanding balance = total − paid − credited (minor units). */
  balanceDueMinor: string;
  daysPastDue: number;
}

export interface AgingBucket {
  key: AgingBucketKey;
  invoices: AgingInvoice[];
  /** Σ balance due across the bucket (minor units). */
  totalMinor: string;
}

const BUCKET_KEYS: readonly AgingBucketKey[] = ['current', '1_30', '31_60', '61_90', '90_plus'];

/**
 * Bucket open invoices by days past due relative to the as-of date. Pure and
 * exported for unit testing. Days past due = asOf − dueDate (calendar days);
 * invoices not yet due land in `current`.
 */
export function bucketAgingInvoices(rows: AgingInvoiceRow[], asOfDate: string): AgingBucket[] {
  const asOf = Date.parse(`${asOfDate}T00:00:00.000Z`);
  const DAY_MS = 86_400_000;

  const buckets = new Map<AgingBucketKey, AgingInvoice[]>();
  for (const key of BUCKET_KEYS) buckets.set(key, []);

  for (const row of rows) {
    const total = BigInt(row.totalAmountMinor);
    const balanceDue = total - BigInt(row.paidAmountMinor) - BigInt(row.creditedAmountMinor);
    if (balanceDue <= 0n) continue; // fully paid/credited — not outstanding

    const daysPastDue = Math.max(0, Math.floor((asOf - Date.parse(`${row.dueDate}T00:00:00.000Z`)) / DAY_MS));
    const key: AgingBucketKey =
      daysPastDue === 0
        ? 'current'
        : daysPastDue <= 30
          ? '1_30'
          : daysPastDue <= 60
            ? '31_60'
            : daysPastDue <= 90
              ? '61_90'
              : '90_plus';

    buckets.get(key)!.push({
      invoiceId: row.id,
      invoiceNumber: row.invoiceNumber,
      customerName: row.customerNameSnapshot,
      invoiceDate: row.invoiceDate,
      dueDate: row.dueDate,
      currency: row.currency,
      balanceDueMinor: balanceDue.toString(),
      daysPastDue,
    });
  }

  return BUCKET_KEYS.map((key) => {
    const invoices = buckets.get(key)!;
    return {
      key,
      invoices,
      totalMinor: invoices.reduce((sum, invoice) => sum + BigInt(invoice.balanceDueMinor), 0n).toString(),
    };
  });
}

/**
 * GetArAgingUseCase — accounts-receivable aging: every open invoice
 * (issued / partially paid / overdue) with its outstanding balance bucketed
 * by days past due as of a date (default: today). Read-only; RLS scopes every
 * row to the org.
 */
@Injectable()
export class GetArAgingUseCase {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: { asOfDate?: string } = {}): Promise<{
    asOfDate: string;
    buckets: AgingBucket[];
    /** Σ balance due across all buckets (minor units). */
    totalOutstandingMinor: string;
  }> {
    TenantContext.requireOrganizationId();

    const asOfDate = input.asOfDate ?? new Date().toISOString().slice(0, 10);

    return this.txManager.run(async (tx) => {
      const rows = await this.repo.listOpenInvoices(tx);
      const buckets = bucketAgingInvoices(rows, asOfDate);
      const totalOutstanding = buckets.reduce((sum, bucket) => sum + BigInt(bucket.totalMinor), 0n);
      return { asOfDate, buckets, totalOutstandingMinor: totalOutstanding.toString() };
    });
  }
}
