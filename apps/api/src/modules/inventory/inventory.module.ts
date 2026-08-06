import { Module } from '@nestjs/common';

import { InventoryController } from './api/index.js';
import {
  AdjustStockUseCase,
  ApplyStockCountUseCase,
  ArchiveProductUseCase,
  CommitReservationUseCase,
  CreateProductUseCase,
  GetAvailabilityUseCase,
  GetStatusUseCase,
  ReceiveStockUseCase,
  ReleaseReservationUseCase,
  ReserveStockUseCase,
  TransferStockUseCase,
} from './application/index.js';
import { INVENTORY_REPOSITORY } from './application/ports/index.js';
import { DrizzleInventoryRepository } from './infrastructure/index.js';

/**
 * InventoryModule — Nest composition of the inventory bounded context.
 *
 * The repository is bound to the INVENTORY_REPOSITORY port token; use cases
 * depend only on the port (MODULE_GUIDE.md §3). The API layer (5.7) adds
 * controllers + @Audit wiring.
 */
@Module({
  controllers: [InventoryController],
  providers: [
    // Repository (infrastructure) bound to the port token.
    { provide: INVENTORY_REPOSITORY, useClass: DrizzleInventoryRepository },
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
    GetAvailabilityUseCase,
  ],
})
export class InventoryModule {}
