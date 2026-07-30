import { describe, expect, it, beforeEach } from 'vitest';

import { CacheService } from '../cache.service.js';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService();
  });

  describe('set and get', () => {
    it('stores and retrieves a value', async () => {
      await cache.set('org-1', 'test', 'key-1', { name: 'hello' });
      const value = await cache.get<{ name: string }>('org-1', 'test', 'key-1');
      expect(value).toEqual({ name: 'hello' });
    });

    it('returns undefined for non-existent keys', async () => {
      const value = await cache.get('org-1', 'test', 'non-existent');
      expect(value).toBeUndefined();
    });

    it('handles string values', async () => {
      await cache.set('org-1', 'test', 'str', 'hello');
      const value = await cache.get<string>('org-1', 'test', 'str');
      expect(value).toBe('hello');
    });

    it('handles numeric values', async () => {
      await cache.set('org-1', 'test', 'num', 42);
      const value = await cache.get<number>('org-1', 'test', 'num');
      expect(value).toBe(42);
    });

    it('handles boolean values', async () => {
      await cache.set('org-1', 'test', 'bool', true);
      const value = await cache.get<boolean>('org-1', 'test', 'bool');
      expect(value).toBe(true);
    });

    it('handles array values', async () => {
      await cache.set('org-1', 'test', 'arr', [1, 2, 3]);
      const value = await cache.get<number[]>('org-1', 'test', 'arr');
      expect(value).toEqual([1, 2, 3]);
    });

    it('handles null values', async () => {
      await cache.set('org-1', 'test', 'null', null);
      const value = await cache.get<null>('org-1', 'test', 'null');
      expect(value).toBeNull();
    });
  });

  describe('TEN-7: Tenant-namespaced cache keys', () => {
    it('TEN-7: same key in different orgs returns different values', async () => {
      await cache.set('org-1', 'module-x', 'my-key', 'value-for-org1');
      await cache.set('org-2', 'module-x', 'my-key', 'value-for-org2');

      const v1 = await cache.get<string>('org-1', 'module-x', 'my-key');
      const v2 = await cache.get<string>('org-2', 'module-x', 'my-key');

      expect(v1).toBe('value-for-org1');
      expect(v2).toBe('value-for-org2');
    });

    it('TEN-7: cache hit in one org does not leak to another', async () => {
      await cache.set('org-1', 'module-x', 'secret', 'confidential');

      const v1 = await cache.get<string>('org-1', 'module-x', 'secret');
      const v2 = await cache.get<string>('org-2', 'module-x', 'secret');

      expect(v1).toBe('confidential');
      expect(v2).toBeUndefined();
    });

    it('TEN-7: same org, different module keys are isolated', async () => {
      await cache.set('org-1', 'module-a', 'key', 'from-a');
      await cache.set('org-1', 'module-b', 'key', 'from-b');

      const fromA = await cache.get<string>('org-1', 'module-a', 'key');
      const fromB = await cache.get<string>('org-1', 'module-b', 'key');

      expect(fromA).toBe('from-a');
      expect(fromB).toBe('from-b');
    });
  });

  describe('TTL and expiry', () => {
    it('respects custom TTL', async () => {
      // Set with a very short TTL (1ms) to force expiry
      await cache.set('org-1', 'test', 'expires', 'value', -1);
      const value = await cache.get<string>('org-1', 'test', 'expires');
      expect(value).toBeUndefined();
    });

    it('default TTL is applied when not specified', async () => {
      await cache.set('org-1', 'test', 'default-ttl', 'value');
      const value = await cache.get<string>('org-1', 'test', 'default-ttl');
      expect(value).toBe('value');
    });

    it('expired entries are cleaned up on get', async () => {
      // Set with 0 TTL (already expired)
      await cache.set('org-1', 'test', 'expired-key', 'value', 0);
      // Wait a tiny bit
      await new Promise((resolve) => setTimeout(resolve, 10));
      const value = await cache.get<string>('org-1', 'test', 'expired-key');
      expect(value).toBeUndefined();
    });
  });

  describe('del', () => {
    it('deletes a specific key', async () => {
      await cache.set('org-1', 'test', 'delete-me', 'value');
      await cache.del('org-1', 'test', 'delete-me');
      const value = await cache.get<string>('org-1', 'test', 'delete-me');
      expect(value).toBeUndefined();
    });

    it('does not affect other keys', async () => {
      await cache.set('org-1', 'test', 'keep', 'value');
      await cache.set('org-1', 'test', 'delete', 'gone');
      await cache.del('org-1', 'test', 'delete');

      const kept = await cache.get<string>('org-1', 'test', 'keep');
      expect(kept).toBe('value');
    });
  });

  describe('clearOrganization', () => {
    it('clears all keys for an organization', async () => {
      await cache.set('org-1', 'a', 'k1', 'v1');
      await cache.set('org-1', 'b', 'k2', 'v2');
      await cache.set('org-2', 'a', 'k3', 'v3'); // Should survive

      await cache.clearOrganization('org-1');

      expect(await cache.get('org-1', 'a', 'k1')).toBeUndefined();
      expect(await cache.get('org-1', 'b', 'k2')).toBeUndefined();
      expect(await cache.get('org-2', 'a', 'k3')).toBe('v3');
    });
  });

  describe('clearModule', () => {
    it('clears all keys for a module within an organization', async () => {
      await cache.set('org-1', 'module-a', 'k1', 'v1');
      await cache.set('org-1', 'module-b', 'k2', 'v2');
      await cache.set('org-1', 'module-a', 'k3', 'v3');

      await cache.clearModule('org-1', 'module-a');

      expect(await cache.get('org-1', 'module-a', 'k1')).toBeUndefined();
      expect(await cache.get('org-1', 'module-a', 'k3')).toBeUndefined();
      expect(await cache.get('org-1', 'module-b', 'k2')).toBe('v2');
    });
  });

  describe('has', () => {
    it('returns true for existing keys', async () => {
      await cache.set('org-1', 'test', 'exists', 'value');
      expect(await cache.has('org-1', 'test', 'exists')).toBe(true);
    });

    it('returns false for non-existent keys', async () => {
      expect(await cache.has('org-1', 'test', 'missing')).toBe(false);
    });

    it('returns false for expired keys', async () => {
      await cache.set('org-1', 'test', 'old', 'value', 0);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await cache.has('org-1', 'test', 'old')).toBe(false);
    });
  });

  describe('getOrSet', () => {
    it('returns cached value without calling factory', async () => {
      await cache.set('org-1', 'test', 'cached', 'from-cache');
      let factoryCalled = false;

      const value = await cache.getOrSet('org-1', 'test', 'cached', async () => {
        factoryCalled = true;
        return 'from-factory';
      });

      expect(value).toBe('from-cache');
      expect(factoryCalled).toBe(false);
    });

    it('calls factory and caches result for missing keys', async () => {
      let factoryCalled = false;

      const value = await cache.getOrSet('org-1', 'test', 'new-key', async () => {
        factoryCalled = true;
        return 'from-factory';
      });

      expect(value).toBe('from-factory');
      expect(factoryCalled).toBe(true);

      // Verify it's cached
      const cached = await cache.get<string>('org-1', 'test', 'new-key');
      expect(cached).toBe('from-factory');
    });
  });

  describe('flush', () => {
    it('clears all entries', async () => {
      await cache.set('org-1', 'a', 'k1', 'v1');
      await cache.set('org-2', 'b', 'k2', 'v2');
      expect(cache.size).toBe(2);

      await cache.flush();
      expect(cache.size).toBe(0);
    });
  });

  describe('size', () => {
    it('starts at 0', () => {
      expect(cache.size).toBe(0);
    });

    it('increments with each unique key', async () => {
      await cache.set('org-1', 'test', 'a', 1);
      await cache.set('org-1', 'test', 'b', 2);
      expect(cache.size).toBe(2);
    });

    it('overwriting same key does not increase size', async () => {
      await cache.set('org-1', 'test', 'a', 1);
      await cache.set('org-1', 'test', 'a', 2);
      expect(cache.size).toBe(1);
    });
  });
});
