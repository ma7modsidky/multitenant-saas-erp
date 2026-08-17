import { POS_EVENTS, posSaleCompletedV1Schema } from '@modubiz/contracts';
import { Injectable, Logger } from '@nestjs/common';

import { type Event } from '../../../../core/events/event-bus.interface.js';
import { HandleEvent } from '../../../../core/events/handle-event.decorator.js';
import { TenantContext, type TenantContextData } from '../../../../core/tenancy/tenant-context.js';

import { GenerateInvoiceFromPosSaleUseCase } from '../../application/index.js';

/**
 * PosSaleCompletedHandler — ACC-13: auto-invoice a completed POS sale,
 * idempotent per sale id.
 *
 * TEN-6: the handler re-establishes tenant context from the payload's
 * `organizationId` before any database access (handlers may run without the
 * publisher's request context — e.g. a replayed event).
 *
 * OPS-3: a failure is logged and swallowed — it must never fail the publishing
 * request (the outbox/queue layer is responsible for retries in Phase 2+).
 */
@Injectable()
export class PosSaleCompletedHandler {
  private readonly logger = new Logger(PosSaleCompletedHandler.name);

  constructor(private readonly generateInvoice: GenerateInvoiceFromPosSaleUseCase) {}

  @HandleEvent(POS_EVENTS.SALE_COMPLETED_V1)
  async handle(event: Event): Promise<void> {
    const parsed = posSaleCompletedV1Schema.safeParse(event.payload);
    if (!parsed.success) {
      this.logger.warn(
        `pos.sale.completed.v1 payload rejected (${parsed.error.issues[0]?.message ?? 'invalid'}); skipping`,
      );
      return;
    }
    const payload = parsed.data;

    const context: TenantContextData = {
      userId: 'system',
      sessionId: undefined,
      organizationId: payload.organizationId,
      roles: [],
      permissions: [],
      locale: payload.locale,
    };

    try {
      await TenantContext.run(context, async () => {
        await this.generateInvoice.execute(payload);
      });
    } catch (error) {
      // OPS-3: never throw back into the publisher. The outbox/queue layer
      // retries with backoff in Phase 2+.
      this.logger.error(
        `Auto-invoice failed for sale ${payload.saleId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
