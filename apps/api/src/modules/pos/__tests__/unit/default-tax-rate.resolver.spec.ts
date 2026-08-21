import { TAX_RATE_READ_PORT, type TaxRateRead, type TaxRateReadPort } from '@modubiz/contracts';
import { describe, expect, it } from 'vitest';

import { PortRegistry } from '../../../../core/ports/port-registry.js';
import { DefaultTaxRateResolver } from '../../application/default-tax-rate.resolver.js';

function makeResolver(defaultRate: TaxRateRead | undefined): DefaultTaxRateResolver {
  const port: TaxRateReadPort = {
    getTaxRateById: async () => undefined,
    getDefaultTaxRate: async () => defaultRate,
  };
  const registry = new PortRegistry();
  registry.register(TAX_RATE_READ_PORT, port);
  return new DefaultTaxRateResolver(registry);
}

describe('DefaultTaxRateResolver (POS-17)', () => {
  it('POS-17: returns the client rate when explicit, without consulting the port', async () => {
    let consulted = false;
    const port: TaxRateReadPort = {
      getTaxRateById: async () => undefined,
      getDefaultTaxRate: async () => {
        consulted = true;
        return undefined;
      },
    };
    const registry = new PortRegistry();
    registry.register(TAX_RATE_READ_PORT, port);
    const resolver = new DefaultTaxRateResolver(registry);
    await expect(resolver.resolveTaxRateBp(700)).resolves.toBe(700);
    expect(consulted).toBe(false);
  });

  it('POS-17: falls back to the org default rate when the client rate is 0', async () => {
    const resolver = makeResolver({
      id: 'x',
      rateBp: 1500,
      type: 'standard',
      taxBasis: 'exclusive',
      coaAccountId: null,
    });
    await expect(resolver.resolveTaxRateBp(0)).resolves.toBe(1500);
  });

  it('POS-17: resolves 0 when the client rate is 0 and no default rate exists', async () => {
    const resolver = makeResolver(undefined);
    await expect(resolver.resolveTaxRateBp(0)).resolves.toBe(0);
  });
});
