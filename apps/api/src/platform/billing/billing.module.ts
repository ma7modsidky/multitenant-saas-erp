import { Module } from '@nestjs/common';

import { AuthModule } from '../../core/auth/auth.module.js';
import { EntitlementsModule } from '../../core/entitlements/entitlements.module.js';
import { BillingController } from './api/index.js';
import {
  CreateSubscriptionUseCase,
  EnableModuleTrialUseCase,
  DisableModuleUseCase,
  HandleWebhookUseCase,
  ReconcileEntitlementsUseCase,
  GetBillingUseCase,
} from './application/index.js';
import { DrizzleBillingRepository } from './infrastructure/repositories/drizzle-billing.repository.js';
import { FakeStripeAdapter } from './infrastructure/stripe/fake-stripe.adapter.js';
import { BILLING_REPOSITORY, STRIPE_PORT } from './ports/index.js';

@Module({
  imports: [AuthModule, EntitlementsModule],
  controllers: [BillingController],
  providers: [
    // Repository
    { provide: BILLING_REPOSITORY, useClass: DrizzleBillingRepository },
    // Stripe adapter (swap to LiveStripeAdapter in production)
    { provide: STRIPE_PORT, useClass: FakeStripeAdapter },
    // Use cases
    CreateSubscriptionUseCase,
    EnableModuleTrialUseCase,
    DisableModuleUseCase,
    HandleWebhookUseCase,
    ReconcileEntitlementsUseCase,
    GetBillingUseCase,
  ],
  exports: [
    BILLING_REPOSITORY,
    STRIPE_PORT,
    ReconcileEntitlementsUseCase,
  ],
})
export class BillingModule {}
