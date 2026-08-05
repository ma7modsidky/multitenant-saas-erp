import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

/**
 * ISO 4217 currency reference data for local development.
 *
 * Kept as plain data (not a migration) because it is reference data, not
 * schema. Seeded idempotently via `ON CONFLICT (code) DO NOTHING`.
 *
 * @see DATA_MODEL.md — core_currencies (read-only reference table)
 */
const CURRENCIES: Array<{ code: string; exponent: number; symbol: string; name: string }> = [
  { code: 'USD', exponent: 2, symbol: '$', name: 'US Dollar' },
  { code: 'EUR', exponent: 2, symbol: '€', name: 'Euro' },
  { code: 'GBP', exponent: 2, symbol: '£', name: 'British Pound' },
  { code: 'JPY', exponent: 0, symbol: '¥', name: 'Japanese Yen' },
  { code: 'CHF', exponent: 2, symbol: 'CHF', name: 'Swiss Franc' },
  { code: 'CAD', exponent: 2, symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', exponent: 2, symbol: 'A$', name: 'Australian Dollar' },
  { code: 'SAR', exponent: 2, symbol: 'SAR', name: 'Saudi Riyal' },
  { code: 'AED', exponent: 2, symbol: 'AED', name: 'UAE Dirham' },
  { code: 'EGP', exponent: 2, symbol: 'EGP', name: 'Egyptian Pound' },
  { code: 'MAD', exponent: 2, symbol: 'MAD', name: 'Moroccan Dirham' },
];

/**
 * Deterministic mock rate — mirrors `SnapshotFxRatesUseCase`
 * (apps/api/src/platform/fx-rates) so a seeded database and a
 * snapshot-triggered database produce the same pairs.
 */
function mockRate(base: string, quote: string): string {
  const baseIdx = base.charCodeAt(0) + base.charCodeAt(1);
  const quoteIdx = quote.charCodeAt(0) + quote.charCodeAt(1);
  return (baseIdx / Math.max(quoteIdx, 1)).toFixed(6);
}

/**
 * Database seed function.
 *
 * Seeds the ISO currency reference table and today's mock FX rate pairs so
 * that cross-currency money flows (e.g. CRM-8 deal conversion) work out of
 * the box in local development. Demo organizations and users are created
 * through the UI signup flow, not here.
 *
 * Both inserts are idempotent: re-running `pnpm db:seed` is safe.
 *
 * @param connectionString - App role connection string
 */
export async function seedDatabase(connectionString: string): Promise<void> {
  const client = postgres(connectionString, { max: 1, prepare: false });
  const db = drizzle(client, { logger: false });

  try {
    console.log('🌱 Seeding database...');

    // ── core_currencies (reference data, idempotent) ────────────────────────
    for (const currency of CURRENCIES) {
      await db.execute(sql`
        INSERT INTO core_currencies (code, exponent, symbol, name)
        VALUES (${currency.code}, ${currency.exponent}, ${currency.symbol}, ${currency.name})
        ON CONFLICT (code) DO NOTHING
      `);
    }
    console.log(`✅ Seeded ${CURRENCIES.length} currencies`);

    // ── core_fx_rates (mock pairs for today, idempotent) ────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const existing = await db.execute<{ base: string; quote: string }>(sql`
      SELECT base_currency AS base, quote_currency AS quote
      FROM core_fx_rates
      WHERE valid_on = ${today}
    `);
    const existingKeys = new Set(existing.map((r) => `${r.base}|${r.quote}`));

    let stored = 0;
    for (const base of CURRENCIES) {
      for (const quote of CURRENCIES) {
        if (quote.code === base.code) continue;
        const key = `${base.code}|${quote.code}`;
        if (existingKeys.has(key)) continue;

        await db.execute(sql`
          INSERT INTO core_fx_rates (base_currency, quote_currency, rate, valid_on, source)
          VALUES (${base.code}, ${quote.code}, ${mockRate(base.code, quote.code)}, ${today}, 'mock')
        `);
        stored++;
      }
    }
    console.log(
      stored > 0
        ? `✅ Seeded ${stored} mock FX rate pairs for ${today}`
        : `ℹ️  FX rates already present for ${today}, skipping`,
    );

    console.log('✅ Database seeded successfully');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}
