import { beforeEach, describe, expect, it } from 'vitest';

import { PortRegistry } from '../port-registry.js';

describe('PortRegistry', () => {
  let registry: PortRegistry;

  beforeEach(() => {
    registry = new PortRegistry();
  });

  describe('register and resolve', () => {
    it('registers and resolves an implementation by token', () => {
      const impl = { greet: () => 'hello' };
      registry.register('CRM_SEARCH_CONTRIBUTOR', impl);

      const resolved = registry.resolve<{ greet: () => string }>('CRM_SEARCH_CONTRIBUTOR');
      expect(resolved).toBe(impl);
      expect(resolved.greet()).toBe('hello');
    });

    it('PLAN-3.4: resolves a Level 3 port implementation with a TransactionRef method', () => {
      const stockPort = {
        reserve: (input: { qty: number }, _tx: unknown) => Promise.resolve({ id: 'res-1' }),
      };
      registry.register('INVENTORY_STOCK_PORT', stockPort);

      const resolved = registry.resolve<typeof stockPort>('INVENTORY_STOCK_PORT');
      expect(resolved).toBe(stockPort);
    });
  });

  describe('duplicate registration', () => {
    it('PLAN-3.4: throws when a token is registered twice (duplicate provider)', () => {
      registry.register('POS_PAYMENTS_PORT', { a: 1 });

      expect(() => registry.register('POS_PAYMENTS_PORT', { b: 2 })).toThrow(
        'Port "POS_PAYMENTS_PORT" is already registered.',
      );
    });
  });

  describe('resolve missing', () => {
    it('PLAN-3.4: throws when resolving an unregistered token', () => {
      expect(() => registry.resolve('UNREGISTERED_PORT')).toThrow('Port "UNREGISTERED_PORT" is not registered.');
    });
  });

  describe('has', () => {
    it('returns true for a registered token and false otherwise', () => {
      registry.register('INVENTORY_STOCK_PORT', {});

      expect(registry.has('INVENTORY_STOCK_PORT')).toBe(true);
      expect(registry.has('MISSING_PORT')).toBe(false);
    });
  });

  describe('tokens', () => {
    it('lists all registered port tokens', () => {
      registry.register('A_PORT', 1);
      registry.register('B_PORT', 2);

      expect(registry.tokens.sort()).toEqual(['A_PORT', 'B_PORT']);
    });
  });
});
