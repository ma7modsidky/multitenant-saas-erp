import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../core/database/database.module.js';
import { GetFxRateUseCase, SnapshotFxRatesUseCase } from './application/index.js';
import { FxRatesController } from './api/index.js';
import { DrizzleFxRatesRepository } from './infrastructure/repositories/drizzle-fx-rates.repository.js';
import { FX_RATES_REPOSITORY } from './ports/index.js';

@Module({
  imports: [DatabaseModule],
  controllers: [FxRatesController],
  providers: [
    GetFxRateUseCase,
    SnapshotFxRatesUseCase,
    {
      provide: FX_RATES_REPOSITORY,
      useClass: DrizzleFxRatesRepository,
    },
  ],
})
export class FxRatesModule {}
