import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '../../../core/common/errors.js';
import type { TxOrDb } from '../../../core/database/repository.base.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { SupplierReturn, type SupplierReturnLineInput } from '../domain/index.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';

export interface CreateSupplierReturnInput {
  supplierId: string;
  billId?: string | null;
  grnLineId?: string | null;
  reasonCode: string;
  currency: string;
  lines: SupplierReturnLineInput[];
}

/**
 * CreateSupplierReturnUseCase — PUR-11: creates a supplier return / debit note
 * in Draft (reason code + bill/GRN reference mandatory). Approval (stock
 * removal + AP reduction + event) happens in ApproveSupplierReturnUseCase.
 */
@Injectable()
export class CreateSupplierReturnUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: CreateSupplierReturnInput): Promise<{ returnId: string; number: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();

    return this.txManager.run(async (tx) => {
      const supplier = await this.repo.findSupplierById(input.supplierId, tx);
      if (!supplier) throw new NotFoundError('PURCHASING_SUPPLIER_NOT_FOUND', { supplierId: input.supplierId });

      const supplierReturn = SupplierReturn.create({
        id: crypto.randomUUID(),
        organizationId,
        number: await this.allocateReturnNumber(tx),
        supplierId: input.supplierId,
        billId: input.billId ?? null,
        grnLineId: input.grnLineId ?? null,
        reasonCode: input.reasonCode,
        currency: input.currency,
        lines: input.lines,
        now,
      });

      await this.repo.insertSupplierReturn(supplierReturn.toJSON(), tx);
      return { returnId: supplierReturn.id, number: supplierReturn.toJSON().number };
    });
  }

  /** PUR-11: sequential, gap-free return numbers per org (RET-xxxxx). */
  private async allocateReturnNumber(tx: TxOrDb): Promise<string> {
    await this.repo.ensureOrgSettings(tx);
    return this.repo.allocateReturnNumber(tx);
  }
}
