import { ConfigService } from '@modubiz/config';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DRIZZLE_DB, type DrizzleDb } from '../../../core/database/drizzle.provider.js';

/**
 * Display-only default list prices (integer minor units, USD) seeded for
 * registered modules. These are planning/display data in core_module_pricing
 * (PLT-6) — the commercial authority stays Stripe (BILL-10), and an admin can
 * edit them from the console. Seeding is `ON CONFLICT DO NOTHING`: existing
 * (admin-edited) rows are never overwritten.
 */
const DEFAULT_MODULE_PRICING: Record<string, { monthly: number; yearly: number }> = {
  crm: { monthly: 2900, yearly: 29000 },
  inventory: { monthly: 3900, yearly: 39000 },
  pos: { monthly: 4900, yearly: 49000 },
};

/**
 * AdminBootstrapService — boot-time seeding for the Platform Admin Console
 * (runs after ModuleRegistry's catalog mirror, via OnApplicationBootstrap):
 *
 *   1. PLT-1: grants `is_platform_admin` to the accounts listed in
 *      PLATFORM_ADMIN_EMAILS. Env-driven grants only — it never revokes.
 *   2. PLT-6: seeds default module pricing rows for registered modules when
 *      missing (never overwrites admin edits).
 *   3. PLT-7: seeds default SaaS settings when missing.
 *
 * All tables touched here are GLOBAL (no RLS) — the same pattern as the
 * module-registry boot validation.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly config: ConfigService,
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.syncPlatformAdmins();
    await this.seedDefaultPricing();
    await this.seedDefaultSettings();
  }

  private async syncPlatformAdmins(): Promise<void> {
    const emails = this.config.platformAdminEmails;
    if (emails.length === 0) return;

    // Same array-binding pattern as the module-registry mirror: postgres-js
    // serializes a JS array parameter as a bare CSV string, which breaks
    // `ANY($1)` (22P02 malformed array literal) — so each element is bound
    // individually inside an explicit ARRAY[...]::text[] constructor.
    await this.db.execute(
      sql`UPDATE core_users SET is_platform_admin = true WHERE lower(email) = ANY(ARRAY[${sql.join(
        emails.map((email) => sql`${email}`),
        sql.raw(','),
      )}]::text[])`,
    );
  }

  private async seedDefaultPricing(): Promise<void> {
    const rows = await this.db.execute<{ key: string }>(sql`SELECT key FROM core_module_catalog`);
    for (const row of rows) {
      const def = DEFAULT_MODULE_PRICING[row.key] ?? { monthly: 0, yearly: 0 };
      await this.db.execute(
        sql`
          INSERT INTO core_module_pricing (module_key, price_monthly_minor, price_yearly_minor, currency)
          VALUES (${row.key}, ${def.monthly}, ${def.yearly}, 'USD')
          ON CONFLICT (module_key) DO NOTHING
        `,
      );
    }
  }

  private async seedDefaultSettings(): Promise<void> {
    const defaults: Array<[string, unknown]> = [
      ['platformName', 'ModuBiz'],
      ['supportEmail', ''],
      ['trialDurationDays', this.config.trialDurationDays],
      ['allowSelfSignup', true],
    ];
    for (const [key, value] of defaults) {
      await this.db.execute(
        sql`
          INSERT INTO core_saas_settings (key, value)
          VALUES (${key}, ${JSON.stringify(value)}::jsonb)
          ON CONFLICT (key) DO NOTHING
        `,
      );
    }
  }
}
