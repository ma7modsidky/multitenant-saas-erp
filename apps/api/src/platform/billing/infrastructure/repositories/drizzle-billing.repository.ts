import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { fromDbDate, toDbDate } from '../../../../core/database/db-date.js';
import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type SubscriptionData } from '../../domain/index.js';
import { type BillingRepository } from '../../ports/index.js';

@Injectable()
export class DrizzleBillingRepository implements BillingRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  private rowToSubscription(row: Record<string, unknown>): SubscriptionData {
    return {
      id: row.id as string,
      organizationId: row.organization_id as string,
      stripeCustomerId: row.stripe_customer_id as string,
      stripeSubscriptionId: row.stripe_subscription_id as string,
      status: row.status as SubscriptionData['status'],
      billingCurrency: row.billing_currency as string,
      currentPeriodEnd: fromDbDate(row.current_period_end),
      createdAt: fromDbDate(row.created_at) as Date,
      updatedAt: fromDbDate(row.updated_at) as Date,
    };
  }

  async findByOrgId(organizationId: string, tx?: TxOrDb): Promise<SubscriptionData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM core_subscriptions WHERE organization_id = ${organizationId} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToSubscription(row);
  }

  async findByStripeSubscriptionId(stripeSubscriptionId: string, tx?: TxOrDb): Promise<SubscriptionData | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT * FROM core_subscriptions WHERE stripe_subscription_id = ${stripeSubscriptionId} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToSubscription(row);
  }

  async insert(data: SubscriptionData, tx?: TxOrDb): Promise<SubscriptionData> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`
        INSERT INTO core_subscriptions
          (id, organization_id, stripe_customer_id, stripe_subscription_id, status, billing_currency, current_period_end, created_at, updated_at)
        VALUES
          (${data.id}, ${data.organizationId}, ${data.stripeCustomerId}, ${data.stripeSubscriptionId}, ${data.status}, ${data.billingCurrency}, ${toDbDate(data.currentPeriodEnd)}, ${toDbDate(data.createdAt)}, ${toDbDate(data.updatedAt)})
        RETURNING *
      `,
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT RETURNING returned no rows');
    return this.rowToSubscription(row);
  }

  async update(id: string, data: Partial<SubscriptionData>, tx?: TxOrDb): Promise<SubscriptionData | undefined> {
    const db = this.getDb(tx);
    const fragments = [sql`updated_at = NOW()`];
    if (data.status !== undefined) fragments.push(sql`status = ${data.status}`);
    if (data.currentPeriodEnd !== undefined)
      fragments.push(sql`current_period_end = ${toDbDate(data.currentPeriodEnd)}`);

    const setClause = sql.join(fragments, sql.raw(', '));
    const rows = await db.execute<Record<string, unknown>>(
      sql`UPDATE core_subscriptions SET ${setClause} WHERE id = ${id} RETURNING *`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.rowToSubscription(row);
  }

  async getOrganizationBaseCurrency(organizationId: string, _tx?: TxOrDb): Promise<string | undefined> {
    // core_organizations is a global (non-RLS) table — a plain read is safe.
    const rows = await this.db.execute<{ base_currency: string | null }>(
      sql`SELECT base_currency FROM core_organizations WHERE id = ${organizationId} LIMIT 1`,
    );
    const row = rows[0];
    return row?.base_currency ?? undefined;
  }

  async findModuleByStripePriceKey(priceKey: string, tx?: TxOrDb): Promise<{ key: string } | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT key FROM core_module_catalog WHERE stripe_price_key = ${priceKey} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return { key: row.key as string };
  }

  async getModuleFromCatalog(
    moduleKey: string,
    tx?: TxOrDb,
  ): Promise<{ key: string; stripePriceKey: string | null; dependsOn: string[]; trialDays: number } | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT key, stripe_price_key, depends_on, trial_days FROM core_module_catalog WHERE key = ${moduleKey} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      key: row.key as string,
      stripePriceKey: row.stripe_price_key as string | null,
      dependsOn: row.depends_on as string[],
      trialDays: row.trial_days as number,
    };
  }

  async getDependentModules(moduleKey: string, tx?: TxOrDb): Promise<string[]> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT key FROM core_module_catalog WHERE ${moduleKey} = ANY(depends_on)`,
    );
    return rows.map((r) => r.key as string);
  }

  async findEntitlement(
    organizationId: string,
    moduleKey: string,
    tx?: TxOrDb,
  ): Promise<
    | {
        id: string;
        moduleKey: string;
        state: string;
        trialStartedAt: Date | null;
        trialEndsAt: Date | null;
        activatedAt: Date | null;
        disabledAt: Date | null;
        purgeAfter: Date | null;
        stripeSubscriptionItemId: string | null;
      }
    | undefined
  > {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT id, module_key, state, trial_started_at, trial_ends_at, activated_at, disabled_at, purge_after, stripe_subscription_item_id
          FROM core_module_entitlements
          WHERE organization_id = ${organizationId} AND module_key = ${moduleKey}
          LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id as string,
      moduleKey: row.module_key as string,
      state: row.state as string,
      trialStartedAt: fromDbDate(row.trial_started_at),
      trialEndsAt: fromDbDate(row.trial_ends_at),
      activatedAt: fromDbDate(row.activated_at),
      disabledAt: fromDbDate(row.disabled_at),
      purgeAfter: fromDbDate(row.purge_after),
      stripeSubscriptionItemId: row.stripe_subscription_item_id as string | null,
    };
  }

  async upsertEntitlement(
    data: {
      organizationId: string;
      moduleKey: string;
      state: string;
      trialStartedAt?: Date | null;
      trialEndsAt?: Date | null;
      activatedAt?: Date | null;
      disabledAt?: Date | null;
      purgeAfter?: Date | null;
      stripeSubscriptionItemId?: string | null;
      updatedBy?: string | null;
    },
    tx?: TxOrDb,
  ): Promise<void> {
    const db = this.getDb(tx);
    const existing = await this.findEntitlement(data.organizationId, data.moduleKey, tx);

    if (existing) {
      const fragments = [sql`updated_at = NOW()`];
      fragments.push(sql`state = ${data.state}`);
      if (data.trialStartedAt !== undefined) fragments.push(sql`trial_started_at = ${toDbDate(data.trialStartedAt)}`);
      if (data.trialEndsAt !== undefined) fragments.push(sql`trial_ends_at = ${toDbDate(data.trialEndsAt)}`);
      if (data.activatedAt !== undefined) fragments.push(sql`activated_at = ${toDbDate(data.activatedAt)}`);
      if (data.disabledAt !== undefined) fragments.push(sql`disabled_at = ${toDbDate(data.disabledAt)}`);
      if (data.purgeAfter !== undefined) fragments.push(sql`purge_after = ${toDbDate(data.purgeAfter)}`);
      if (data.stripeSubscriptionItemId !== undefined)
        fragments.push(sql`stripe_subscription_item_id = ${data.stripeSubscriptionItemId}`);

      const setClause = sql.join(fragments, sql.raw(', '));
      await db.execute(sql`UPDATE core_module_entitlements SET ${setClause} WHERE id = ${existing.id}`);
    } else {
      await db.execute(sql`
        INSERT INTO core_module_entitlements
          (id, organization_id, module_key, state, trial_started_at, trial_ends_at, activated_at, disabled_at, purge_after, stripe_subscription_item_id, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${data.organizationId}, ${data.moduleKey}, ${data.state},
           ${toDbDate(data.trialStartedAt ?? null)}, ${toDbDate(data.trialEndsAt ?? null)},
           ${toDbDate(data.activatedAt ?? null)}, ${toDbDate(data.disabledAt ?? null)},
           ${toDbDate(data.purgeAfter ?? null)}, ${data.stripeSubscriptionItemId ?? null},
           NOW(), NOW())
      `);
    }
  }

  async updateEntitlementState(organizationId: string, moduleKey: string, state: string, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(
      sql`UPDATE core_module_entitlements SET state = ${state}, updated_at = NOW() WHERE organization_id = ${organizationId} AND module_key = ${moduleKey}`,
    );
  }

  async findEntitlementsByOrg(
    organizationId: string,
    tx?: TxOrDb,
  ): Promise<Array<{ id: string; moduleKey: string; state: string }>> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT id, module_key, state FROM core_module_entitlements WHERE organization_id = ${organizationId}`,
    );
    return rows.map((r) => ({ id: r.id as string, moduleKey: r.module_key as string, state: r.state as string }));
  }

  async findActiveSubscriptionItems(
    organizationId: string,
    tx?: TxOrDb,
  ): Promise<Array<{ moduleKey: string; stripeSubscriptionItemId: string | null; state: string }>> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT module_key, stripe_subscription_item_id, state FROM core_module_entitlements WHERE organization_id = ${organizationId} AND state IN ('active', 'trialing')`,
    );
    return rows.map((r) => ({
      moduleKey: r.module_key as string,
      stripeSubscriptionItemId: r.stripe_subscription_item_id as string | null,
      state: r.state as string,
    }));
  }
}
