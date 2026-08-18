import { Inject, Injectable } from '@nestjs/common';

import { ConflictError } from '../../../core/common/errors.js';
import type { TxOrDb } from '../../../core/database/repository.base.js';
import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { UnitOfWork } from '../../../core/database/unit-of-work.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Supplier, type PaymentTerms, type SupplierInput } from '../domain/index.js';

import { PURCHASING_REPOSITORY, type PurchasingRepository } from './ports/index.js';
import { buildSupplierCreatedEvent } from '../events/published/index.js';

export interface CreateSupplierInput {
  name: string;
  taxId?: string | null;
  paymentTerms?: PaymentTerms;
  currency?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: Record<string, unknown> | null;
  bankAccount?: Record<string, unknown> | null;
}

/**
 * CreateSupplierUseCase — PUR-1: a supplier requires a name; a tax id, when
 * provided, is unique per organization. The directory records payment terms
 * (PUR-10), tax id, contact details, default billing currency, and address.
 */
@Injectable()
export class CreateSupplierUseCase {
  constructor(
    @Inject(PURCHASING_REPOSITORY)
    private readonly repo: PurchasingRepository,
    private readonly txManager: TransactionManager,
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(input: CreateSupplierInput): Promise<{ supplierId: string; code: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();

    const committed = await this.txManager.run(async (tx) => {
      // PUR-1: tax id unique per org when provided.
      if (input.taxId && input.taxId.trim() !== '') {
        const existing = await this.repo.findSupplierByTaxId(input.taxId.trim(), tx);
        if (existing) {
          throw new ConflictError(
            'PURCHASING_SUPPLIER_TAX_ID_EXISTS',
            'A supplier with this tax id already exists (PUR-1).',
            {
              taxId: input.taxId,
            },
          );
        }
      }

      const supplier = Supplier.create({
        id: crypto.randomUUID(),
        code: await this.allocateSupplierCode(tx),
        ...input,
        // TEN-2: the session-derived org is authoritative — spread `...input`
        // FIRST so an injected `organizationId` in the payload can never
        // override TenantContext (RLS is the real defence; this is defense in
        // depth).
        organizationId,
        now,
      } satisfies SupplierInput);

      await this.repo.insertSupplier(supplier.toJSON(), tx);

      const event = buildSupplierCreatedEvent(
        organizationId,
        supplier.id,
        supplier.toJSON().name,
        supplier.toJSON().taxId,
        supplier.toJSON().currency,
        now,
      );
      return { supplierId: supplier.id, code: supplier.toJSON().code, event };
    });

    this.unitOfWork.addEvent(committed.event);
    await this.unitOfWork.publishEvents();
    return { supplierId: committed.supplierId, code: committed.code };
  }

  /** PUR-1: sequential, gap-free supplier codes per org (SUP-xxxxx). */
  private async allocateSupplierCode(tx: TxOrDb): Promise<string> {
    await this.repo.ensureOrgSettings(tx);
    // The repository allocates the next code atomically (UPDATE ... RETURNING).
    return this.repo.allocateSupplierCode(tx);
  }
}
