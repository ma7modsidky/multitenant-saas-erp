import type { TxOrDb } from '../../../core/database/repository.base.js';

export interface FxRatesRepository {
  /** Get the most recent FX rate for a currency pair. */
  getLatestRate(
    baseCurrency: string,
    quoteCurrency: string,
    tx?: TxOrDb,
  ): Promise<{ rate: string; validOn: string; source: string } | undefined>;

  /** Get a rate snapshot for a specific date (closest prior). */
  getRateForDate(
    baseCurrency: string,
    quoteCurrency: string,
    date: string,
    tx?: TxOrDb,
  ): Promise<{ rate: string; validOn: string; source: string } | undefined>;

  /** Insert a new FX rate snapshot. */
  insertRate(
    data: {
      baseCurrency: string;
      quoteCurrency: string;
      rate: string;
      validOn: string;
      source: string;
    },
    tx?: TxOrDb,
  ): Promise<void>;

  /** List all supported currencies. */
  listCurrencies(tx?: TxOrDb): Promise<Array<{ code: string; exponent: number; symbol: string; name: string }>>;

  /** Get the most recent rates for all pairs from a base currency. */
  getLatestRatesForBase(
    baseCurrency: string,
    tx?: TxOrDb,
  ): Promise<Array<{ quoteCurrency: string; rate: string; validOn: string }>>;
}

export const FX_RATES_REPOSITORY = Symbol('FX_RATES_REPOSITORY');
