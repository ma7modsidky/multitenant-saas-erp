import { Global, Module } from '@nestjs/common';

import { InMemoryJobQueue, type IJobQueue } from './job-queue.js';

/**
 * JobsModule — async job processing infrastructure.
 *
 * Provides:
 *   - IJobQueue (via 'JOB_QUEUE' injection token): async job processing
 *   - InMemoryJobQueue: in-memory implementation (Phase 1.11)
 *
 * Jobs carry organizationId and re-establish tenant context
 * before database access (TEN-6).
 *
 * Phase 2+ will replace with BullMQ backed by Redis.
 *
 * @see PLAN.md §1.11 — Jobs
 * @see BUSINESS_RULES.md — TEN-6
 */
@Global()
@Module({
  providers: [
    {
      provide: 'JOB_QUEUE',
      useClass: InMemoryJobQueue,
    },
    InMemoryJobQueue,
  ],
  exports: ['JOB_QUEUE', InMemoryJobQueue],
})
export class JobsModule {}
