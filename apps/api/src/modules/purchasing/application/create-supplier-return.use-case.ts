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

      // ACC-11: inherit each line's tax rate + the supplier tax id from the
      // referenced bill (matched by variant) so the return reverses the same
      // input-VAT the bill recognized.
      const bill = input.billId ? await this.repo.findBillById(input.billId, tx) : undefined;
      const taxRateByVariant = new Map<string, number>();
      if (bill) {
        for (const line of bill.lines) {
          if (line.variantId !== null && line.taxRateBpSnapshot > 0) {
            taxRateByVariant.set(line.variantId, line.taxRateBpSnapshot);
          }
        }
      }

      const lines = input.lines.map((line) => ({
        ...line,
        ...(line.variantId !== null && line.variantId !== undefined
          ? { taxRateBpSnapshot: taxRateByVariant.get(line.variantId) ?? 0 }
          : {}),
      }));

      const supplierReturn = SupplierReturn.create({
        id: crypto.randomUUID(),
        organizationId,
        number: await this.allocateReturnNumber(tx),
        supplierId: input.supplierId,
        billId: input.billId ?? null,
        grnLineId: input.grnLineId ?? null,
        reasonCode: input.reasonCode,
        currency: input.currency,
        supplierTaxIdSnapshot: bill?.supplierTaxIdSnapshot ?? null,
        lines,
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
