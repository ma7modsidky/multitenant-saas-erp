import { FX_RATE_READ_PORT } from '@modubiz/contracts';
import { Module, type OnModuleInit } from '@nestjs/common';

import { DatabaseModule } from '../../core/database/database.module.js';
import { PortRegistry } from '../../core/ports/port-registry.js';

import { FxRatesController } from './api/index.js';
import { GetFxRateUseCase, SnapshotFxRatesUseCase } from './application/index.js';
import { DrizzleFxRateReadPort } from './infrastructure/read-ports/drizzle-fx-rate-read.port.js';
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
    // Level 2 read port implementation (consumed by business modules)
    DrizzleFxRateReadPort,
  ],
})
export class FxRatesModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    // Concrete class here (not the contracts interface): Nest DI resolves
    // runtime providers, and TS interfaces are erased at compile time.
    private readonly fxRateReadPort: DrizzleFxRateReadPort,
  ) {}

  onModuleInit(): void {
    this.portRegistry.register(FX_RATE_READ_PORT, this.fxRateReadPort);
  }
}
