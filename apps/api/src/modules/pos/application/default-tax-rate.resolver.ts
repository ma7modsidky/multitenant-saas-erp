import { TAX_RATE_READ_PORT, type TaxRateReadPort } from '@modubiz/contracts';
import { Injectable } from '@nestjs/common';

import { PortRegistry } from '../../../core/ports/port-registry.js';

/**
 * DefaultTaxRateResolver — POS-17: resolves the organization's default tax
 * rate (ACC-11) through the Level 2 TAX_RATE_READ_PORT and applies it as a
 * fallback to POS lines that carry no explicit rate (the client hardcodes
 * `taxRateBp: 0` today). Lines with an explicit rate are left untouched.
 *
 * The accounting module registers the implementation during its `onModuleInit`
 * (after provider construction), so the port is resolved LAZILY on first use.
 */
@Injectable()
export class DefaultTaxRateResolver {
  private port: TaxRateReadPort | null = null;

  constructor(private readonly portRegistry: PortRegistry) {}

  private getPort(): TaxRateReadPort {
    this.port ??= this.portRegistry.resolve<TaxRateReadPort>(TAX_RATE_READ_PORT);
    return this.port;
  }

  /**
   * POS-17: the effective rate bp for a line — the client rate when explicit,
   * otherwise the org's default rate (0 when no default exists).
   */
  async resolveTaxRateBp(clientRateBp: number): Promise<number> {
    if (clientRateBp > 0) return clientRateBp;
    const rate = await this.getPort().getDefaultTaxRate();
    return rate?.rateBp ?? 0;
  }
}
