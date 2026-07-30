import { Global, Module } from '@nestjs/common';

import { CacheService } from './cache.service.js';

/**
 * CacheModule — tenant-namespaced caching infrastructure.
 *
 * Provides:
 *   - CacheService: in-memory cache with keys prefixed by organization ID
 *     to prevent cross-tenant cache hits (TEN-7)
 *
 * Phase 1.11 uses in-memory storage. Phase 2+ will replace with
 * Redis-backed implementation using ioredis.
 *
 * @see PLAN.md §1.11 — Cache
 * @see BUSINESS_RULES.md — TEN-7
 */
@Global()
@Module({
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
