import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { AppExceptionFilter } from './app-exception.filter.js';
import { HealthController } from './health.controller.js';
import { ResponseInterceptor } from './response.interceptor.js';

/**
 * CommonModule — global module providing shared HTTP infrastructure.
 *
 * Registers globally:
 *   1. AppExceptionFilter — catches all exceptions and maps to `{ error }` format
 *   2. ResponseInterceptor — wraps successful responses in `{ data, meta }` format
 *
 * Also hosts infrastructure controllers that belong to no business module:
 *   - HealthController — unauthenticated GET /health liveness probe
 *
 * This module MUST be imported FIRST in AppModule so that the exception
 * filter and response interceptor wrap all other module handlers.
 *
 * @see CODING_STANDARDS.md §7 — Error model and wire format
 * @see ARCHITECTURE.md §3 — core/common
 */
@Module({
  controllers: [HealthController],
  providers: [
    // Global exception filter — runs for every request
    {
      provide: APP_FILTER,
      useClass: AppExceptionFilter,
    },
    // Global response interceptor — wraps success responses
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
  ],
})
export class CommonModule {}
