import { TAX_RATE_READ_PORT, type TaxRateRead, type TaxRateReadPort } from '@modubiz/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { TenantContext } from '../../../../core/tenancy/tenant-context.js';

import { ACCOUNTING_REPOSITORY, type AccountingRepository } from '../../application/ports/index.js';

/**
 * TaxRateReadPortImpl — the Level 2 read port that lets POS and Purchasing
 * resolve a tax rate from the catalog WITHOUT importing accounting source
 * (hard rule #1). Registered on the platform PortRegistry by the Accounting
 * module; consumers inject PortRegistry + the TAX_RATE_READ_PORT token only.
 *
 * Reads run inside the caller's ambient tenant context (RLS scopes the read to
 * the org), so the caller must be inside a tenant-bound transaction or at
 * least a TenantContext.run() scope.
 */
@Injectable()
export class TaxRateReadPortImpl implements TaxRateReadPort {
  constructor(
    @Inject(ACCOUNTING_REPOSITORY)
    private readonly repo: AccountingRepository,
  ) {}

  async getTaxRateById(taxRateId: string): Promise<TaxRateRead | undefined> {
    const row = await this.repo.findTaxRateById(taxRateId);
    if (!row || !row.isActive) return undefined;
    return this.toRead(row);
  }

  async getDefaultTaxRate(): Promise<TaxRateRead | undefined> {
    TenantContext.requireOrganizationId();
    const row = await this.repo.getDefaultTaxRate();
    if (!row) return undefined;
    return this.toRead(row);
  }

  private toRead(row: {
    id: string;
    rateBp: number;
    type: string;
    taxBasis: string;
    coaAccountId: string | null;
  }): TaxRateRead {
    return {
      id: row.id,
      rateBp: row.rateBp,
      type: row.type as TaxRateRead['type'],
      taxBasis: row.taxBasis as TaxRateRead['taxBasis'],
      coaAccountId: row.coaAccountId,
    };
  }
}

void TAX_RATE_READ_PORT;
