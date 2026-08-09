import { Inject, Injectable } from '@nestjs/common';

import { TransactionManager } from '../../../core/database/transaction-manager.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { Register } from '../domain/index.js';

import { POS_REPOSITORY, type PosRepository } from './ports/index.js';

export interface CreateRegisterInput {
  name: string;
  code: string;
  /** POS-1: the warehouse all stock movements from this register affect. */
  warehouseId: string;
}

/**
 * CreateRegisterUseCase — creates a register (till) bound to one warehouse.
 *
 * Business rules:
 * - POS-1: the register is bound to exactly one warehouse; every sale on it
 *   deducts stock from that warehouse.
 * - Register codes are unique per org among non-deleted registers (surfaced
 *   as POS_REGISTER_DUPLICATE_CODE by the repository).
 */
@Injectable()
export class CreateRegisterUseCase {
  constructor(
    @Inject(POS_REPOSITORY)
    private readonly repo: PosRepository,
    private readonly txManager: TransactionManager,
  ) {}

  async execute(input: CreateRegisterInput): Promise<{ id: string; warehouseId: string }> {
    const organizationId = TenantContext.requireOrganizationId();
    const now = new Date();

    const register = Register.create({
      id: crypto.randomUUID(),
      organizationId,
      name: input.name,
      code: input.code,
      warehouseId: input.warehouseId,
      receiptPrefix: 'R',
      nextReceiptNumber: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    return this.txManager.run(async (tx) => {
      const persisted = await this.repo.insertRegister(register.toJSON(), tx);
      return { id: persisted.id, warehouseId: persisted.warehouseId };
    });
  }
}
