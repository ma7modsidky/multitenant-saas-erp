import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@modubiz/config';

/**
 * ConfigModule — global module providing the Zod-validated ConfigService.
 *
 * The ONLY place in the application that reads `process.env` is
 * `@modubiz/config`. This module exposes the validated service to the
 * whole dependency graph so core/platform/module code never touches
 * `process.env` directly.
 *
 * @see CODING_STANDARDS.md §11 — process.env must only be read in packages/config
 * @see ARCHITECTURE.md §3 — core/config
 */
@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useFactory: () => new ConfigService(),
    },
  ],
  exports: [ConfigService],
})
export class ConfigModule {}
