import { INVENTORY_STOCK_PORT } from '@modubiz/contracts';
import { Module, type OnModuleInit } from '@nestjs/common';

import { PortRegistry } from '../../core/ports/port-registry.js';

import { InventoryController } from './api/index.js';
import {
  AdjustStockUseCase,
  ApplyStockCountUseCase,
  ArchiveProductUseCase,
  CommitReservationUseCase,
  CreateProductUseCase,
  CreateStockCountUseCase,
  GetAvailabilityUseCase,
  GetStatusUseCase,
  ListProductsUseCase,
  ListStockCountsUseCase,
  ListStockLevelsUseCase,
  ListWarehousesUseCase,
  ReceiveStockUseCase,
  ReleaseReservationUseCase,
  ReserveStockUseCase,
  TransferStockUseCase,
} from './application/index.js';
import { INVENTORY_REPOSITORY } from './application/ports/index.js';
import { DrizzleInventoryRepository } from './infrastructure/index.js';
import { InventoryStockPortImpl } from './infrastructure/ports/inventory-stock.port.impl.js';
import { LowStockAlertJob, ReservationExpiryJob, StockReconciliationJob } from './jobs/index.js';

/**
 * InventoryModule — Nest composition of the inventory bounded context.
 *
 * The repository is bound to the INVENTORY_REPOSITORY port token; use cases
 * depend only on the port (MODULE_GUIDE.md §3). The Level 3 stock port
 * (INVENTORY_STOCK_PORT) is provided to the platform PortRegistry so POS can
 * deduct stock inside its own checkout transaction (POS-15). Job processors
 * consume the platform in-memory job queue (TEN-6).
 */
@Module({
  controllers: [InventoryController],
  providers: [
    // Repository (infrastructure) bound to the port token.
    { provide: INVENTORY_REPOSITORY, useClass: DrizzleInventoryRepository },
    // Level 3 stock port implementation (consumed by POS via PortRegistry).
    InventoryStockPortImpl,
    // Use cases (application).
    GetStatusUseCase,
    CreateProductUseCase,
    ArchiveProductUseCase,
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
    ListWarehousesUseCase,
    ListStockLevelsUseCase,
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
  ) {}

  onModuleInit(): void {
    this.portRegistry.register(INVENTORY_STOCK_PORT, this.stockPort);
  }
}
