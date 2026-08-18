import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import type { TxOrDb } from '../../../core/database/repository.base.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Bill, type BillLineInput } from '../domain/index.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

export interface CreateBillInput {
  supplierId: string;
  poId?: string | null;
  grnId?: string | null;
  billDate?: string;
  dueDate?: string | null;
  currency: string;
  supplierTaxIdSnapshot?: string | null;
  idempotencyKey?: string | null;
  lines: BillLineInput[];
}

/**
 * CreateBillUseCase — PUR-6: creates a purchase bill in Draft. Approval (the
 * three-way match + AP ledger entry + event) happens in ApproveBillUseCase.
 */
@Injectable()
export class CreateBillUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: CreateBillInput): Promise<{ billId: string; number: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();

    return this.txManager.run(async (tx) => {
      const supplier = await this.repo.findSupplierById(input.supplierId, tx);
      if (!supplier) throw new NotFoundError('PURCHASING_SUPPLIER_NOT_FOUND', { supplierId: input.supplierId });

      const bill = Bill.create({
        id: crypto.randomUUID(),
        organizationId,
        number: await this.allocateBillNumber(tx),
        supplierId: input.supplierId,
        poId: input.poId ?? null,
        grnId: input.grnId ?? null,
        ...(input.billDate !== undefined ? { billDate: input.billDate } : {}),
        dueDate: input.dueDate ?? null,
        currency: input.currency,
        supplierTaxIdSnapshot: input.supplierTaxIdSnapshot ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        lines: input.lines,
        now,
      });

      await this.repo.insertBill(bill.toJSON(), tx);
      return { billId: bill.id, number: bill.toJSON().number };
    });
  }

  /** PUR-6: sequential, gap-free bill numbers per org (BILL-xxxxx). */
  private async allocateBillNumber(tx: TxOrDb): Promise<string> {
    await this.repo.ensureOrgSettings(tx);
    return this.repo.allocateBillNumber(tx);
  }
}
