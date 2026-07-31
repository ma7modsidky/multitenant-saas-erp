import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DRIZZLE_DB, type DrizzleDb } from '../../../../core/database/drizzle.provider.js';
import type { TxOrDb } from '../../../../core/database/repository.base.js';
import { type FxRatesRepository } from '../../ports/index.js';

@Injectable()
export class DrizzleFxRatesRepository implements FxRatesRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: DrizzleDb,
  ) {}

  private getDb(tx?: TxOrDb): PostgresJsDatabase {
    return (tx ?? this.db) as PostgresJsDatabase;
  }

  async getLatestRate(baseCurrency: string, quoteCurrency: string, tx?: TxOrDb): Promise<{ rate: string; validOn: string; source: string } | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT rate::text, valid_on::text, source FROM core_fx_rates
          WHERE base_currency = ${baseCurrency} AND quote_currency = ${quoteCurrency}
          ORDER BY valid_on DESC LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      rate: row.rate as string,
      validOn: row.valid_on as string,
      source: row.source as string,
    };
  }

  async getRateForDate(baseCurrency: string, quoteCurrency: string, date: string, tx?: TxOrDb): Promise<{ rate: string; validOn: string; source: string } | undefined> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT rate::text, valid_on::text, source FROM core_fx_rates
          WHERE base_currency = ${baseCurrency} AND quote_currency = ${quoteCurrency} AND valid_on <= ${date}::date
          ORDER BY valid_on DESC LIMIT 1`,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      rate: row.rate as string,
      validOn: row.valid_on as string,
      source: row.source as string,
    };
  }

  async insertRate(data: { baseCurrency: string; quoteCurrency: string; rate: string; validOn: string; source: string }, tx?: TxOrDb): Promise<void> {
    const db = this.getDb(tx);
    await db.execute(sql`
      INSERT INTO core_fx_rates (id, base_currency, quote_currency, rate, valid_on, source, created_at)
      VALUES (gen_random_uuid(), ${data.baseCurrency}, ${data.quoteCurrency}, ${data.rate}::numeric, ${data.validOn}::date, ${data.source}, NOW())
      ON CONFLICT DO NOTHING
    `);
  }

  async listCurrencies(tx?: TxOrDb): Promise<Array<{ code: string; exponent: number; symbol: string; name: string }>> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT code, exponent, symbol, name FROM core_currencies ORDER BY code`,
    );
    return rows.map((r) => ({
      code: r.code as string,
      exponent: r.exponent as number,
      symbol: r.symbol as string,
      name: r.name as string,
    }));
  }

  async getLatestRatesForBase(baseCurrency: string, tx?: TxOrDb): Promise<Array<{ quoteCurrency: string; rate: string; validOn: string }>> {
    const db = this.getDb(tx);
    const rows = await db.execute<Record<string, unknown>>(
      sql`SELECT DISTINCT ON (quote_currency) quote_currency, rate::text, valid_on::text
          FROM core_fx_rates
          WHERE base_currency = ${baseCurrency}
          ORDER BY quote_currency, valid_on DESC`,
    );
    return rows.map((r) => ({
      quoteCurrency: r.quote_currency as string,
      rate: r.rate as string,
      validOn: r.valid_on as string,
    }));
  }
}
