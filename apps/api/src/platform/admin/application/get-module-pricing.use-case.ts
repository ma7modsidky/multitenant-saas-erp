import { Inject, Injectable } from '@nestjs/common';

import { MODULE_PRICING_REPOSITORY, type ModulePricingRepository } from '../ports/index.js';

/**
 * GetModulePricingUseCase — the module catalog joined with its admin-editable
 * pricing rows for the pricing editor (PLT-6).
 */
@Injectable()
export class GetModulePricingUseCase {
  constructor(
    @Inject(MODULE_PRICING_REPOSITORY)
    private readonly pricingRepo: ModulePricingRepository,
  ) {}

  async execute(): Promise<
    Array<{
      moduleKey: string;
      name: string;
      description: string | null;
      icon: string | null;
      dependsOn: string[];
      priceMonthlyMinor: string;
      priceYearlyMinor: string;
      currency: string;
    }>
  > {
    return this.pricingRepo.listWithCatalog();
  }
}
