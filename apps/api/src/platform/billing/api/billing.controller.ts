import type { IncomingMessage } from 'node:http';

import { ConfigService } from '@modubiz/config';
import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards, UsePipes, Headers } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { RequiresPermission } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { PublicRoute } from '../../../core/tenancy/system-context.decorator.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import {
  CreateSubscriptionUseCase,
  EnableModuleTrialUseCase,
  DisableModuleUseCase,
  HandleWebhookUseCase,
  ReconcileEntitlementsUseCase,
  GetBillingUseCase,
} from '../application/index.js';

import {
  createSubscriptionSchema,
  enableModuleTrialSchema,
  disableModuleSchema,
  CreateSubscriptionDto,
  EnableModuleTrialDto,
  BillingDisableModuleDto,
  BillingResponse,
  BillingEnvelopeResponse,
  SubscriptionCreatedEnvelopeResponse,
  ReconcileEnvelopeResponse,
  WebhookResponse,
  BillingMessageEnvelopeResponse,
} from './dto/index.js';

@Controller('v1')
@UseGuards(AuthGuard('jwt'))
export class BillingController {
  constructor(
    private readonly createSubscriptionUseCase: CreateSubscriptionUseCase,
    private readonly enableModuleTrialUseCase: EnableModuleTrialUseCase,
    private readonly disableModuleUseCase: DisableModuleUseCase,
    private readonly reconcileEntitlementsUseCase: ReconcileEntitlementsUseCase,
    private readonly getBillingUseCase: GetBillingUseCase,
    private readonly handleWebhookUseCase: HandleWebhookUseCase,
    private readonly config: ConfigService,
  ) {}

  @Get('organizations/:orgId/billing')
  @ApiOkResponse({ type: BillingEnvelopeResponse })
  async getBilling(@Param('orgId') orgId: string): Promise<{ data: BillingResponse }> {
    const result = await this.getBillingUseCase.execute({ organizationId: orgId });
    return { data: result };
  }

  @Post('organizations/:orgId/billing/subscription')
  @ApiCreatedResponse({ type: SubscriptionCreatedEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(createSubscriptionSchema))
  @RequiresPermission('platform:billing:manage')
  async createSubscription(
    @Param('orgId') orgId: string,
    @Body() dto: CreateSubscriptionDto,
  ): Promise<{ data: { subscriptionId: string } }> {
    const result = await this.createSubscriptionUseCase.execute({
      ...dto,
      organizationId: orgId,
    });
    return { data: result };
  }

  @Post('organizations/:orgId/billing/trial')
  @ApiCreatedResponse({ type: BillingMessageEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(enableModuleTrialSchema))
  @RequiresPermission('platform:billing:manage')
  async enableTrial(
    @Param('orgId') orgId: string,
    @Body() dto: EnableModuleTrialDto,
  ): Promise<{ data: { message: string } }> {
    const userId = TenantContext.requireUserId();
    await this.enableModuleTrialUseCase.execute({
      organizationId: orgId,
      moduleKey: dto.moduleKey,
      userId,
      skipTrial: dto.skipTrial,
    });
    return { data: { message: `Module '${dto.moduleKey}' enabled.` } };
  }

  @Post('organizations/:orgId/billing/disable')
  @ApiCreatedResponse({ type: BillingMessageEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(disableModuleSchema))
  @RequiresPermission('platform:billing:manage')
  async disableModule(
    @Param('orgId') orgId: string,
    @Body() dto: BillingDisableModuleDto,
  ): Promise<{ data: { message: string } }> {
    await this.disableModuleUseCase.execute({
      organizationId: orgId,
      moduleKey: dto.moduleKey,
    });
    return { data: { message: `Module '${dto.moduleKey}' disabled.` } };
  }

  @Post('organizations/:orgId/billing/reconcile')
  @ApiCreatedResponse({ type: ReconcileEnvelopeResponse })
  @RequiresPermission('platform:billing:manage')
  async reconcile(@Param('orgId') orgId: string): Promise<{ data: { updated: number; alerts: string[] } }> {
    const result = await this.reconcileEntitlementsUseCase.execute({ organizationId: orgId });
    return { data: result };
  }

  /**
   * POST /v1/billing/webhook
   * Stripe webhook endpoint — no auth (signature verification is auth).
   */
  @PublicRoute()
  @Post('billing/webhook')
  @ApiCreatedResponse({ type: WebhookResponse })
  async handleWebhook(
    @Req() req: IncomingMessage,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean }> {
    // @ts-expect-error — body may be a string or Buffer depending on the body parser
    const body = req.body as string | undefined;
    const payload = typeof body === 'string' ? body : JSON.stringify(body ?? {});

    const result = await this.handleWebhookUseCase.execute({
      payload,
      signature: signature ?? '',
      secret: this.config.stripeWebhookSecret,
    });

    return result;
  }
}
