import { type FxRateRead, type FxRateReadPort } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../../core/database/transaction-manager.js';
import { FX_RATES_REPOSITORY, type FxRatesRepository } from '../../ports/index.js';

/**
 * DrizzleFxRateReadPort — implements `FxRateReadPort` (Level 2 read port
 * declared in @modubiz/contracts) for the CRM module.
 *
 * Resolves the latest FX rate for a pair (CUR-6: closest prior snapshot).
 * Returns undefined when no snapshot exists — the deal domain then raises
 * DEAL_FX_RATE_REQUIRED (a module-domain 422) instead of a platform 404.
 *
 * Registered in the core PortRegistry by FxRatesModule.onModuleInit.
 *
 * @see ARCHITECTURE.md §6 — Level 2: read-only query port
 */
@Injectable()
export class DrizzleFxRateReadPort implements FxRateReadPort {
  constructor(
    @Inject(FX_RATES_REPOSITORY)
    private readonly fxRatesRepo: FxRatesRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async getRate(baseCurrency: string, quoteCurrency: string): Promise<FxRateRead | undefined> {
    return this.txManager.run(async (tx) => {
      const rate = await this.fxRatesRepo.getLatestRate(baseCurrency, quoteCurrency, tx);
      if (!rate) return undefined;
      return {
        rate: Number(rate.rate),
        source: rate.source,
        validOn: new Date(rate.validOn),
      };
    });
  }
}
