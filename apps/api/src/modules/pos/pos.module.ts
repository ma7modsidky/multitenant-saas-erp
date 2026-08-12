import { Module, type OnModuleInit } from '@nestjs/common';

import { AuditBeforeStateRegistry, tableRowLoader } from '../../core/audit/__init__.js';

import { PosController } from './api/index.js';
import {
  CheckoutUseCase,
  CloseShiftUseCase,
  CreateRegisterUseCase,
  GetSaleUseCase,
  GetShiftReportUseCase,
  GetStatusUseCase,
  ListRegistersUseCase,
  ListSalesUseCase,
  ListShiftsUseCase,
  OpenShiftUseCase,
  ProcessRefundUseCase,
  SyncOfflineSaleUseCase,
  VoidSaleUseCase,
} from './application/index.js';
import { POS_REPOSITORY } from './application/ports/index.js';
import { DrizzlePosRepository } from './infrastructure/index.js';

/**
 * PosModule — Nest composition of the pos bounded context.
 *
 * The repository is bound to the POS_REPOSITORY port token; use cases depend
 * only on the port (MODULE_GUIDE.md §3). The Level 3 INVENTORY_STOCK_PORT is
 * resolved from the platform PortRegistry at construction — inventory's
 * implementation joins POS's checkout transaction for atomic stock deduction
 * (POS-15).
 */
@Module({
  controllers: [PosController],
  providers: [
    // Repository (infrastructure) bound to the port token.
    { provide: POS_REPOSITORY, useClass: DrizzlePosRepository },
    // Use cases (application).
    GetStatusUseCase,
    CreateRegisterUseCase,
    ListRegistersUseCase,
    OpenShiftUseCase,
    CloseShiftUseCase,
    CheckoutUseCase,
    VoidSaleUseCase,
    ProcessRefundUseCase,
    SyncOfflineSaleUseCase,
    ListSalesUseCase,
    GetSaleUseCase,
    ListShiftsUseCase,
    GetShiftReportUseCase,
  ],
})
export class PosModule implements OnModuleInit {
  constructor(private readonly auditBeforeState: AuditBeforeStateRegistry) {}

  onModuleInit(): void {
    // AUD-1: pre-mutation snapshots for @Audit({ captureBefore }) routes.
    this.auditBeforeState.register('register', tableRowLoader('pos_registers'));
    this.auditBeforeState.register('shift', tableRowLoader('pos_shifts'));
    this.auditBeforeState.register('sale', tableRowLoader('pos_sales'));
    this.auditBeforeState.register('refund', tableRowLoader('pos_refunds'));
  }
}
