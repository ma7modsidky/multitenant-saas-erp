import { Injectable, Logger } from '@nestjs/common';

/**
 * Cache entry with optional TTL.
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number | null; // timestamp in ms, null = no expiry
}

/**
 * CacheService — in-memory cache with tenant-namespaced keys.
 *
 * Cache key format: `org:<orgId>:<module>:<key>` (TEN-7)
 * This prevents cache key collisions between tenants.
 *
 * Phase 1.11 uses an in-memory store. Phase 2+ will replace with
 * Redis-backed implementation using ioredis.
 *
 * @see TEN-7 — Cache keys are tenant-namespaced
 * @see PLAN.md §1.11 — Cache
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Build a tenant-namespaced cache key (TEN-7).
   */
  private buildKey(organizationId: string, module: string, key: string): string {
    return `org:${organizationId}:${module}:${key}`;
  }

  /**
   * Get a value from cache.
   * Returns undefined if the key doesn't exist or has expired.
   */
  async get<T>(organizationId: string, module: string, key: string): Promise<T | undefined> {
    const cacheKey = this.buildKey(organizationId, module, key);
    const entry = this.store.get(cacheKey);

    if (!entry) {
      return undefined;
    }

    // Check expiry
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(cacheKey);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Set a value in cache with optional TTL.
   * @param ttlMs — TTL in milliseconds (defaults to 5 minutes)
   */
  async set<T>(
    organizationId: string,
    module: string,
    key: string,
    value: T,
    ttlMs?: number,
  ): Promise<void> {
    const cacheKey = this.buildKey(organizationId, module, key);
    const expiresAt = ttlMs !== undefined ? Date.now() + ttlMs : Date.now() + this.DEFAULT_TTL_MS;

    this.store.set(cacheKey, { value, expiresAt });
    this.logger.debug(`Cache SET: ${cacheKey}`);
  }

  /**
   * Delete a specific key from cache.
   */
  async del(organizationId: string, module: string, key: string): Promise<void> {
    const cacheKey = this.buildKey(organizationId, module, key);
    this.store.delete(cacheKey);
    this.logger.debug(`Cache DEL: ${cacheKey}`);
  }

  /**
   * Delete all keys for a given organization.
   * Useful on logout/org switch (POS-31 pattern).
   */
  async clearOrganization(organizationId: string): Promise<void> {
    const prefix = `org:${organizationId}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
    this.logger.debug(`Cache cleared for organization: ${organizationId}`);
  }

  /**
   * Delete all keys for a given organization + module.
   */
  async clearModule(organizationId: string, module: string): Promise<void> {
    const prefix = `org:${organizationId}:${module}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
    this.logger.debug(`Cache cleared for ${module} in org: ${organizationId}`);
  }

  /**
   * Flush entire cache (use with care).
   */
  async flush(): Promise<void> {
    this.store.clear();
    this.logger.debug('Cache flushed');
  }

  /**
   * Check if a key exists and is not expired.
   */
  async has(organizationId: string, module: string, key: string): Promise<boolean> {
    const value = await this.get(organizationId, module, key);
    return value !== undefined;
  }

  /**
   * Get or set a value atomically.
   * If the key exists, return it. Otherwise, call the factory function,
   * store the result, and return it.
   */
  async getOrSet<T>(
    organizationId: string,
    module: string,
    key: string,
    factory: () => Promise<T>,
    ttlMs?: number,
  ): Promise<T> {
    const existing = await this.get<T>(organizationId, module, key);
    if (existing !== undefined) {
      return existing;
    }

    const value = await factory();
    await this.set(organizationId, module, key, value, ttlMs);
    return value;
  }

  /**
   * Get the total number of cache entries.
   * Useful for monitoring and tests.
   */
  get size(): number {
    return this.store.size;
  }
}
