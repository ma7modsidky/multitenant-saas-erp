import { Module, type OnModuleInit } from '@nestjs/common';

import { DatabaseModule } from '../../core/database/database.module.js';
import {
  BootValidationService,
  EnableModuleUseCase,
  DisableModuleUseCase,
  GetNavigationUseCase,
  ListModulesUseCase,
} from './application/index.js';
import { ModuleRegistryController } from './api/index.js';
import { DrizzleModuleRegistryRepository } from './infrastructure/repositories/drizzle-module-registry.repository.js';
import { MODULE_REGISTRY_REPOSITORY } from './ports/index.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ModuleRegistryController],
  providers: [
    BootValidationService,
    EnableModuleUseCase,
    DisableModuleUseCase,
    GetNavigationUseCase,
    ListModulesUseCase,
    {
      provide: MODULE_REGISTRY_REPOSITORY,
      useClass: DrizzleModuleRegistryRepository,
    },
  ],
  exports: [BootValidationService],
})
export class ModuleRegistryModule implements OnModuleInit {
  constructor(private readonly bootValidation: BootValidationService) {}

  async onModuleInit(): Promise<void> {
    await this.bootValidation.validateAndSync();
  }
}
