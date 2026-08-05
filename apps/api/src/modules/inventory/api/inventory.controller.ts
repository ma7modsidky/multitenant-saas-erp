import { Controller, Get } from '@nestjs/common';

import { PublicRoute } from '../../../core/tenancy/system-context.decorator.js';
import { GetStatusUseCase } from '../application/index.js';

/**
 * Inventory controller. No business logic — validate, delegate, map, return.
 *
 * @see MODULE_GUIDE.md §4 — Step 6: API layer
 */
@Controller('v1/inventory')
export class InventoryController {
  constructor(private readonly getStatus: GetStatusUseCase) {}

  /** Public status probe (replace with @RequiresModule + @RequiresPermission routes). */
  @PublicRoute()
  @Get('status')
  async status(): Promise<{ data: { module: string; status: string } }> {
    return { data: await this.getStatus.execute() };
  }
}
