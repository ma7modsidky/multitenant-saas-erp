import { Module } from '@nestjs/common';

import { EntitlementsModule } from '../../core/entitlements/__init__.js';

import { PurchasingController } from './api/index.js';
import {
  ApproveBillUseCase,
  ApprovePurchaseOrderUseCase,
  ApproveRequisitionUseCase,
  ApproveSupplierReturnUseCase,
  CreateBillUseCase,
  CreatePurchaseOrderUseCase,
  CreateSupplierReturnUseCase,
  CreateSupplierUseCase,
  GetBillUseCase,
  GetGrnUseCase,
  GetPaymentUseCase,
  GetPurchaseOrderUseCase,
  GetStatusUseCase,
  GetSupplierReturnUseCase,
  GetSupplierUseCase,
  GetVendorBalancesUseCase,
  ListBillsUseCase,
  ListGrnsUseCase,
  ListPaymentsUseCase,
  ListPurchaseOrdersUseCase,
  ListSuppliersUseCase,
  ListSupplierReturnsUseCase,
  ReceiveGrnUseCase,
  RecordSupplierPaymentUseCase,
  SubmitRequisitionUseCase,
  UpdateSupplierUseCase,
} from './application/index.js';
import { PURCHASING_REPOSITORY } from './application/ports/index.js';
import { DrizzlePurchasingRepository } from './infrastructure/index.js';

/**
 * PurchasingModule — Nest composition of the purchasing bounded context.
 *
 * The repository is bound to the PURCHASING_REPOSITORY port token; use cases
 * depend only on the port (MODULE_GUIDE.md §3). The INVENTORY_MOVEMENT_PORT is
 * resolved lazily via PortRegistry (GRN receiving, bill cost variance,
 * supplier returns) so purchasing never imports Inventory's source.
 * EntitlementsModule provides EntitlementService for the PUR-12 feature gate.
 */
@Module({
  imports: [EntitlementsModule],
  controllers: [PurchasingController],
  providers: [
    // Repository (infrastructure) bound to the port token.
    { provide: PURCHASING_REPOSITORY, useClass: DrizzlePurchasingRepository },
    // Use cases (application).
    GetStatusUseCase,
    CreateSupplierUseCase,
    UpdateSupplierUseCase,
    ListSuppliersUseCase,
    GetSupplierUseCase,
    SubmitRequisitionUseCase,
    ApproveRequisitionUseCase,
    CreatePurchaseOrderUseCase,
    ApprovePurchaseOrderUseCase,
    ListPurchaseOrdersUseCase,
    GetPurchaseOrderUseCase,
    ReceiveGrnUseCase,
    ListGrnsUseCase,
    GetGrnUseCase,
    ApproveBillUseCase,
    CreateBillUseCase,
    ListBillsUseCase,
    GetBillUseCase,
    RecordSupplierPaymentUseCase,
    ListPaymentsUseCase,
    GetPaymentUseCase,
    ApproveSupplierReturnUseCase,
    CreateSupplierReturnUseCase,
    ListSupplierReturnsUseCase,
    GetSupplierReturnUseCase,
    GetVendorBalancesUseCase,
  ],
})
export class PurchasingModule {}
