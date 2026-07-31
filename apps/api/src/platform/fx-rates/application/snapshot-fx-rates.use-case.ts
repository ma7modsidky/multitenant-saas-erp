import { Inject, Injectable, Logger } from '@nestjs/common';

import { FX_RATES_REPOSITORY, type FxRatesRepository } from '../ports/index.js';

/**
 * Daily FX rate snapshot job.
 * Fetches rates from the configured provider and stores them in core_fx_rates.
 *
 * In development, this uses mock rates. In production, it would call an
 * external FX rate provider API.
 *
 * @see PLAN.md §2.8 — FX rates
 * @see BUSINESS_RULES.md — CUR-6
 */
@Injectable()
export class SnapshotFxRatesUseCase {
  private readonly logger = new Logger(SnapshotFxRatesUseCase.name);

  constructor(
    @Inject(FX_RATES_REPOSITORY)
    private readonly repo: FxRatesRepository,
  ) {}

  async execute(): Promise<{ pairsStored: number; source: string }> {
    // Get all supported currencies
    const currencies = await this.repo.listCurrencies();
    const codes = currencies.map((c) => c.code);

    if (codes.length < 2) {
      this.logger.warn('Not enough currencies to create rate snapshots');
      return { pairsStored: 0, source: 'mock' };
    }

    const today = new Date().toISOString().slice(0, 10);
    let stored = 0;

    // Generate mock rates between all currency pairs
    // In production, this would call an external API
    for (const base of codes) {
      for (const quote of codes) {
        if (base === quote) continue;

        // Mock rate: uses a simple deterministic formula
        const baseIdx = base.charCodeAt(0) + base.charCodeAt(1);
        const quoteIdx = quote.charCodeAt(0) + quote.charCodeAt(1);
        const mockRate = (baseIdx / Math.max(quoteIdx, 1)).toFixed(6);

        await this.repo.insertRate({
          baseCurrency: base,
          quoteCurrency: quote,
          rate: mockRate,
          validOn: today,
          source: 'mock',
        });

        stored++;
      }
    }

    this.logger.log(`Stored ${stored} FX rate pairs for ${today}`);
    return { pairsStored: stored, source: 'mock' };
  }
}
