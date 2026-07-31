import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import { FX_RATE_NOT_FOUND, CURRENCY_NOT_FOUND } from '../domain/index.js';
import { FX_RATES_REPOSITORY, type FxRatesRepository } from '../ports/index.js';

/**
 * Get the latest (or historical) FX rate for a currency pair.
 *
 * CUR-6: Uses the most recent prior snapshot; if none exists, returns FX_RATE_UNAVAILABLE.
 *
 * @see PLAN.md §2.8 — FX rates
 * @see BUSINESS_RULES.md — CUR-6
 */
@Injectable()
export class GetFxRateUseCase {
  constructor(
    @Inject(FX_RATES_REPOSITORY)
    private readonly repo: FxRatesRepository,
  ) {}

  async execute(input: {
    baseCurrency: string;
    quoteCurrency: string;
    date?: string;
  }): Promise<{ baseCurrency: string; quoteCurrency: string; rate: string; validOn: string; source: string }> {
    // Validate currencies exist
    const currencies = await this.repo.listCurrencies();
    const baseExists = currencies.some((c) => c.code === input.baseCurrency);
    const quoteExists = currencies.some((c) => c.code === input.quoteCurrency);

    if (!baseExists) {
      throw new NotFoundError(CURRENCY_NOT_FOUND, { currency: input.baseCurrency });
    }
    if (!quoteExists) {
      throw new NotFoundError(CURRENCY_NOT_FOUND, { currency: input.quoteCurrency });
    }

    // Get the rate
    const rate = input.date
      ? await this.repo.getRateForDate(input.baseCurrency, input.quoteCurrency, input.date)
      : await this.repo.getLatestRate(input.baseCurrency, input.quoteCurrency);

    if (!rate) {
      throw new NotFoundError(FX_RATE_NOT_FOUND, {
        baseCurrency: input.baseCurrency,
        quoteCurrency: input.quoteCurrency,
        date: input.date ?? 'latest',
      });
    }

    return {
      baseCurrency: input.baseCurrency,
      quoteCurrency: input.quoteCurrency,
      rate: rate.rate,
      validOn: rate.validOn,
      source: rate.source,
    };
  }
}
