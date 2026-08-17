import { INVENTORY_MOVEMENT_PORT, INVENTORY_STOCK_PORT } from '@modubiz/contracts';
import { Module, type OnModuleInit } from '@nestjs/common';

import { AuditBeforeStateRegistry, tableRowLoader } from '../../core/audit/__init__.js';
import { PortRegistry } from '../../core/ports/port-registry.js';

import { InventoryController } from './api/index.js';
import {
  AddVariantUseCase,
  AdjustStockUseCase,
  ApplyStockCountUseCase,
  ArchiveProductUseCase,
  ArchiveVariantUseCase,
  UnarchiveProductUseCase,
  UnarchiveVariantUseCase,
  CommitReservationUseCase,
  CreateProductUseCase,
  CreateStockCountUseCase,
  CreateWarehouseUseCase,
  GetAvailabilityUseCase,
  GetProductUseCase,
  GetStatusUseCase,
  GetStockCountUseCase,
  ListMovementsUseCase,
  ListProductsUseCase,
  ListReservationsUseCase,
  ListStockCountsUseCase,
  ListStockLevelsUseCase,
  ListVariantsUseCase,
  ListWarehousesUseCase,
  ReceiveStockUseCase,
  ReleaseReservationUseCase,
  ReserveStockUseCase,
  TransferStockUseCase,
  UpdateProductUseCase,
  UpdateVariantUseCase,
} from './application/index.js';
import { INVENTORY_REPOSITORY } from './application/ports/index.js';
import { DrizzleInventoryRepository } from './infrastructure/index.js';
import { InventoryMovementPortImpl } from './infrastructure/ports/inventory-movement.port.impl.js';
import { InventoryStockPortImpl } from './infrastructure/ports/inventory-stock.port.impl.js';
import { LowStockAlertJob, ReservationExpiryJob, StockReconciliationJob } from './jobs/index.js';

/**
 * InventoryModule — Nest composition of the inventory bounded context.
 *
 * The repository is bound to the INVENTORY_REPOSITORY port token; use cases
 * depend only on the port (MODULE_GUIDE.md §3). Two Level 3 ports are
 * provided to the platform PortRegistry: INVENTORY_STOCK_PORT (reservations,
 * POS-15) and INVENTORY_MOVEMENT_PORT (Phase 7.0 — receive/issue/
 * returnToSupplier/adjustCost for Purchasing and Accounting). Job processors
 * consume the platform in-memory job queue (TEN-6).
 */
@Module({
  controllers: [InventoryController],
  providers: [
    // Repository (infrastructure) bound to the port token.
    { provide: INVENTORY_REPOSITORY, useClass: DrizzleInventoryRepository },
    // Level 3 port implementations (consumed via PortRegistry — stock by POS,
    // movement by Purchasing/Accounting).
    InventoryStockPortImpl,
    InventoryMovementPortImpl,
    // Use cases (application).
    GetStatusUseCase,
    CreateProductUseCase,
    UpdateProductUseCase,
    AddVariantUseCase,
    UpdateVariantUseCase,
    ArchiveVariantUseCase,
    UnarchiveVariantUseCase,
    GetProductUseCase,
    CreateWarehouseUseCase,
    ListReservationsUseCase,
    GetStockCountUseCase,
    ArchiveProductUseCase,
    UnarchiveProductUseCase,
    ReceiveStockUseCase,
    AdjustStockUseCase,
    TransferStockUseCase,
    ReserveStockUseCase,
    CommitReservationUseCase,
    ReleaseReservationUseCase,
    ApplyStockCountUseCase,
    CreateStockCountUseCase,
    GetAvailabilityUseCase,
    ListProductsUseCase,
    ListVariantsUseCase,
    ListWarehousesUseCase,
    ListStockLevelsUseCase,
    ListMovementsUseCase,
    ListStockCountsUseCase,
    // Job processors (invoked by the platform scheduler; payloads carry orgId).
    ReservationExpiryJob,
    LowStockAlertJob,
    StockReconciliationJob,
  ],
})
export class InventoryModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    // Concrete class here (not the contracts interface): Nest DI resolves
    // runtime providers, and TS interfaces are erased at compile time.
    private readonly stockPort: InventoryStockPortImpl,
    private readonly movementPort: InventoryMovementPortImpl,
    private readonly auditBeforeState: AuditBeforeStateRegistry,
  ) {}

  onModuleInit(): void {
    this.portRegistry.register(INVENTORY_STOCK_PORT, this.stockPort);
    this.portRegistry.register(INVENTORY_MOVEMENT_PORT, this.movementPort);

    // AUD-1: pre-mutation snapshots for @Audit({ captureBefore }) routes.
    // Table-backed loaders read the row inside the tenant-bound transaction
    // (RLS scopes the read); rows are normalized to the camelCase the request
    // DTO snapshots use so before/after diff cleanly.
    this.auditBeforeState.register('product', tableRowLoader('inv_products'));
    this.auditBeforeState.register('product_variant', tableRowLoader('inv_product_variants'));
    this.auditBeforeState.register('stock_movement', tableRowLoader('inv_stock_movements'));
    this.auditBeforeState.register('stock_count', tableRowLoader('inv_stock_counts'));
    this.auditBeforeState.register('warehouse', tableRowLoader('inv_warehouses'));
    this.auditBeforeState.register('reservation', tableRowLoader('inv_stock_reservations'));
  }
}
