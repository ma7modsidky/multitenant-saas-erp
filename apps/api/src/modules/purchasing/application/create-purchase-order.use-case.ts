import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import type { TxOrDb } from '../../../core/database/repository.base.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { PurchaseOrder, PO_STATUS, type PoLineInput } from '../domain/index.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

export interface CreatePurchaseOrderInput {
  supplierId: string;
  currency: string;
  orderDate?: string;
  expectedDate?: string | null;
  notes?: string | null;
  lines: PoLineInput[];
}

/**
 * CreatePurchaseOrderUseCase — PUR-3/PUR-8: creates a PO in Draft. Lines
 * reference inventory variants by id without a FK, or are service lines;
 * name + unit cost are snapshotted so the document stays reproducible.
 */
@Injectable()
export class CreatePurchaseOrderUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: CreatePurchaseOrderInput): Promise<{ purchaseOrderId: string; number: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();

    return this.txManager.run(async (tx) => {
      const supplier = await this.repo.findSupplierById(input.supplierId, tx);
      if (!supplier) throw new NotFoundError('PURCHASING_SUPPLIER_NOT_FOUND', { supplierId: input.supplierId });

      const po = PurchaseOrder.create({
        id: crypto.randomUUID(),
        organizationId,
        number: await this.allocatePoNumber(tx),
        supplierId: input.supplierId,
        currency: input.currency,
        ...(input.orderDate !== undefined ? { orderDate: input.orderDate } : {}),
        expectedDate: input.expectedDate ?? null,
        notes: input.notes ?? null,
        lines: input.lines,
        now,
      });

      await this.repo.insertPurchaseOrder(po.toJSON(), tx);
      return { purchaseOrderId: po.id, number: po.toJSON().number };
    });
  }

  /** PUR-3: sequential, gap-free PO numbers per org (PO-xxxxx). */
  private async allocatePoNumber(tx: TxOrDb): Promise<string> {
    await this.repo.ensureOrgSettings(tx);
    return this.repo.allocatePoNumber(tx);
  }
}
