import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError, ValidationError } from '../../../core/common/errors.js';
import { MODULE_NOT_FOUND } from '../../billing/domain/index.js';
import { MODULE_REGISTRY_REPOSITORY, type ModuleRegistryRepository } from '../../module-registry/ports/index.js';
import {
  MODULE_PRICING_REPOSITORY,
  PLATFORM_AUDIT_REPOSITORY,
  type ModulePricingRepository,
  type PlatformAuditRepository,
} from '../ports/index.js';

const NON_NEGATIVE_INTEGER = /^\d+$/;

/**
 * UpdateModulePricingUseCase — admin edits a module's list prices (PLT-6).
 *
 * Pricing lives in core_module_pricing (display/planning data) and is never
 * overwritten by the boot-time catalog mirror. The commercial authority stays
 * Stripe (BILL-10). Amounts are integer minor units as strings (CUR-9).
 */
@Injectable()
export class UpdateModulePricingUseCase {
  constructor(
    @Inject(MODULE_PRICING_REPOSITORY)
    private readonly pricingRepo: ModulePricingRepository,
    @Inject(MODULE_REGISTRY_REPOSITORY)
    private readonly moduleRegistryRepo: ModuleRegistryRepository,
    @Inject(PLATFORM_AUDIT_REPOSITORY)
    private readonly auditRepo: PlatformAuditRepository,
  ) {}

  async execute(input: {
    moduleKey: string;
    priceMonthlyMinor: string;
    priceYearlyMinor: string;
    currency: string;
    actorUserId: string | null;
    actorEmail: string | null;
  }): Promise<{
    moduleKey: string;
    priceMonthlyMinor: string;
    priceYearlyMinor: string;
    currency: string;
  }> {
    if (!NON_NEGATIVE_INTEGER.test(input.priceMonthlyMinor) || !NON_NEGATIVE_INTEGER.test(input.priceYearlyMinor)) {
      throw new ValidationError('VALIDATION_ERROR', 'Prices must be non-negative integer minor units', {
        issues: [{ path: 'priceMonthlyMinor', code: 'invalid_type' }],
      });
    }

    const catalogEntry = await this.moduleRegistryRepo.getModule(input.moduleKey);
    if (!catalogEntry) {
      throw new NotFoundError(MODULE_NOT_FOUND, { moduleKey: input.moduleKey });
    }

    const currency = input.currency.toUpperCase();
    await this.pricingRepo.upsert({
      moduleKey: input.moduleKey,
      priceMonthlyMinor: input.priceMonthlyMinor,
      priceYearlyMinor: input.priceYearlyMinor,
      currency,
      updatedBy: input.actorUserId,
    });

    await this.auditRepo.insert({
      action: 'module.pricing.updated',
      entityType: 'module',
      entityId: input.moduleKey,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      after: {
        moduleKey: input.moduleKey,
        priceMonthlyMinor: input.priceMonthlyMinor,
        priceYearlyMinor: input.priceYearlyMinor,
        currency,
      },
    });

    return {
      moduleKey: input.moduleKey,
      priceMonthlyMinor: input.priceMonthlyMinor,
      priceYearlyMinor: input.priceYearlyMinor,
      currency,
    };
  }
}
