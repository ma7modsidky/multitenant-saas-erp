import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { GetFxRateUseCase, SnapshotFxRatesUseCase } from '../application/index.js';
import { FX_RATES_REPOSITORY, type FxRatesRepository } from '../ports/index.js';
import { type FxRateResponse, type FxRatesListResponse, type CurrencyResponse } from './dto/index.js';

@Controller('v1')
@UseGuards(AuthGuard('jwt'))
export class FxRatesController {
  constructor(
    private readonly getFxRateUseCase: GetFxRateUseCase,
    private readonly snapshotFxRatesUseCase: SnapshotFxRatesUseCase,
    @Inject(FX_RATES_REPOSITORY)
    private readonly repo: FxRatesRepository,
  ) {}

  @Get('currencies')
  async listCurrencies(): Promise<{ data: CurrencyResponse[] }> {
    const currencies = await this.repo.listCurrencies();
    return { data: currencies };
  }

  @Get('fx-rates/:baseCurrency')
  async getRatesForBase(@Param('baseCurrency') baseCurrency: string): Promise<{ data: FxRatesListResponse }> {
    const rates = await this.repo.getLatestRatesForBase(baseCurrency.toUpperCase());
    return {
      data: {
        baseCurrency: baseCurrency.toUpperCase(),
        rates,
      },
    };
  }

  @Get('fx-rates/:baseCurrency/:quoteCurrency')
  async getRate(
    @Param('baseCurrency') baseCurrency: string,
    @Param('quoteCurrency') quoteCurrency: string,
    @Query('date') date?: string,
  ): Promise<{ data: FxRateResponse }> {
    const result = await this.getFxRateUseCase.execute({
      baseCurrency: baseCurrency.toUpperCase(),
      quoteCurrency: quoteCurrency.toUpperCase(),
      ...(date !== undefined ? { date } : {}),
    });
    return { data: result };
  }

  @Get('fx-rates/snapshot')
  async triggerSnapshot(): Promise<{ data: { pairsStored: number; source: string } }> {
    const result = await this.snapshotFxRatesUseCase.execute();
    return { data: result };
  }
}
