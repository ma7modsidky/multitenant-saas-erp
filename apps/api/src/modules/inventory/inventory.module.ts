import { Module } from '@nestjs/common';

import { InventoryController } from './api/index.js';
import { GetStatusUseCase } from './application/index.js';

/**
 * InventoryModule — Nest composition of the inventory bounded context.
 *
 * @see MODULE_GUIDE.md §3 — Canonical folder skeleton
 */
@Module({
  controllers: [InventoryController],
  providers: [GetStatusUseCase],
})
export class InventoryModule {}
