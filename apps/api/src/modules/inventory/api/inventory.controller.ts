import { MODULE_KEYS } from '@modubiz/contracts';
import { Body, Controller, Get, Param, Post, UseGuards, UsePipes } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresModule, RequiresPermission } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { PublicRoute } from '../../../core/tenancy/system-context.decorator.js';
import { subtractQuantity } from '../domain/index.js';
import {
  AdjustStockUseCase,
  ApplyStockCountUseCase,
  ArchiveProductUseCase,
  CommitReservationUseCase,
  CreateProductUseCase,
  CreateStockCountUseCase,
  GetStatusUseCase,
  ListProductsUseCase,
  ListStockCountsUseCase,
  ListStockLevelsUseCase,
  ListWarehousesUseCase,
  ReceiveStockUseCase,
  ReleaseReservationUseCase,
  ReserveStockUseCase,
  TransferStockUseCase,
} from '../application/index.js';

import {
  AdjustStockDto,
  CreateProductDto,
  CreateStockCountDto,
  MovementResultEnvelopeResponse,
  ProductEnvelopeResponse,
  ProductListEnvelopeResponse,
  ReceiveStockDto,
  ReservationResultEnvelopeResponse,
  ReserveStockDto,
  StockCountEnvelopeResponse,
  StockCountListEnvelopeResponse,
  StockLevelListEnvelopeResponse,
  TransferStockDto,
  WarehouseListEnvelopeResponse,
  adjustStockSchema,
  createProductSchema,
  createStockCountSchema,
  receiveStockSchema,
  reserveStockSchema,
  transferStockSchema,
} from './dto/index.js';

/**
 * InventoryController — inventory endpoints of the inventory bounded context
 * (`/v1/inventory/...`).
 *
 * All routes require JWT auth + the `inventory` module entitlement (AUTHZ-6) +
 * the matching permission. Controllers validate, delegate to a use case, and
 * map the response — no business logic (hard rule #6).
 *
 * @see INV-4 (adjust reason), INV-5 (available), INV-7 (reserve), INV-8 (commit/release),
 *      INV-9 (transfer), INV-10 (SKU unique), INV-12 (moving average), INV-14 (counts)
 */
@Controller('v1/inventory')
@UseGuards(AuthGuard('jwt'))
@RequiresModule(MODULE_KEYS.INVENTORY)
export class InventoryController {
  constructor(
    private readonly getStatus: GetStatusUseCase,
    private readonly listProducts: ListProductsUseCase,
    private readonly listWarehouses: ListWarehousesUseCase,
    private readonly listStockLevels: ListStockLevelsUseCase,
    private readonly listStockCounts: ListStockCountsUseCase,
    private readonly createProduct: CreateProductUseCase,
    private readonly archiveProduct: ArchiveProductUseCase,
    private readonly receiveStock: ReceiveStockUseCase,
    private readonly adjustStock: AdjustStockUseCase,
    private readonly transferStock: TransferStockUseCase,
    private readonly reserveStock: ReserveStockUseCase,
    private readonly commitReservation: CommitReservationUseCase,
    private readonly releaseReservation: ReleaseReservationUseCase,
    private readonly createStockCount: CreateStockCountUseCase,
    private readonly applyStockCount: ApplyStockCountUseCase,
  ) {}

  /** Public status probe. */
  @PublicRoute()
  @Get('status')
  async status(): Promise<{ data: { module: string; status: string } }> {
    return { data: await this.getStatus.execute() };
  }

  // ─── Products (INV-10, INV-11) ─────────────────────────────────────────

  @Get('products')
  @ApiOkResponse({ type: ProductListEnvelopeResponse })
  @RequiresPermission('inventory:product:read')
  async listProductsRoute(): Promise<{ data: { items: Record<string, unknown>[] } }> {
    const rows = await this.listProducts.execute();
    return { data: { items: rows.map(toProductResponse) } };
  }

  @Post('products')
  @ApiCreatedResponse({ type: ProductEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(createProductSchema))
  @RequiresPermission('inventory:product:write')
  @Audit({ action: 'CREATE', entityType: 'product', captureAfter: true })
  async createProductRoute(@Body() dto: CreateProductDto): Promise<{ data: Record<string, unknown> }> {
    const result = await this.createProduct.execute({
      nameI18n: dto.nameI18n,
      sku: dto.sku,
      barcode: dto.barcode ?? null,
      priceAmountMinor: dto.price.amountMinor,
      priceCurrency: dto.price.currency,
      costAmountMinor: dto.cost.amountMinor,
      costCurrency: dto.cost.currency,
      reorderPoint: dto.reorderPoint,
      reorderQuantity: dto.reorderQuantity,
    });
    return { data: { productId: result.productId, variantId: result.variantId } };
  }

  @Post('products/:id/archive')
  @ApiOkResponse()
  @RequiresPermission('inventory:product:write')
  @Audit({ action: 'UPDATE', entityType: 'product' })
  async archiveProductRoute(@Param('id') id: string): Promise<{ data: { archivedAt: string } }> {
    return { data: await this.archiveProduct.execute(id) };
  }

  // ─── Stock movements (INV-3, INV-4, INV-9, INV-12, INV-16) ─────────────

  @Post('stock/receive')
  @ApiCreatedResponse({ type: MovementResultEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(receiveStockSchema))
  @RequiresPermission('inventory:stock:adjust')
  @Audit({ action: 'CREATE', entityType: 'stock_movement', captureAfter: true })
  async receiveStockRoute(@Body() dto: ReceiveStockDto): Promise<{ data: { movementId: string } }> {
    return {
      data: await this.receiveStock.execute({
        variantId: dto.variantId,
        // exactOptionalPropertyTypes: only set warehouseId when the client sent one.
        ...(dto.warehouseId !== undefined && dto.warehouseId !== null ? { warehouseId: dto.warehouseId } : {}),
        quantity: dto.quantity,
        unitCostAmountMinor: dto.unitCost.amountMinor,
        unitCostCurrency: dto.unitCost.currency,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        ...(dto.idempotencyKey !== undefined ? { idempotencyKey: dto.idempotencyKey } : {}),
      }),
    };
  }

  @Post('stock/adjust')
  @ApiCreatedResponse({ type: MovementResultEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(adjustStockSchema))
  @RequiresPermission('inventory:stock:adjust')
  @Audit({ action: 'UPDATE', entityType: 'stock_movement', captureAfter: true })
  async adjustStockRoute(@Body() dto: AdjustStockDto): Promise<{ data: { movementId: string } }> {
    return {
      data: await this.adjustStock.execute({
        variantId: dto.variantId,
        // exactOptionalPropertyTypes: only set warehouseId when the client sent one.
        ...(dto.warehouseId !== undefined && dto.warehouseId !== null ? { warehouseId: dto.warehouseId } : {}),
        quantity: dto.quantity,
        reasonCode: dto.reasonCode,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
      }),
    };
  }

  @Post('stock/transfer')
  @ApiCreatedResponse()
  @UsePipes(new ZodValidationPipe(transferStockSchema))
  @RequiresPermission('inventory:transfer:execute')
  @Audit({ action: 'UPDATE', entityType: 'stock_movement', captureAfter: true })
  async transferStockRoute(
    @Body() dto: TransferStockDto,
  ): Promise<{ data: { transferOutId: string; transferInId: string } }> {
    return {
      data: await this.transferStock.execute({
        variantId: dto.variantId,
        fromWarehouseId: dto.fromWarehouseId,
        toWarehouseId: dto.toWarehouseId,
        quantity: dto.quantity,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
      }),
    };
  }

  // ─── Reservations (INV-5, INV-7, INV-8) ─────────────────────────────────

  @Post('stock/reserve')
  @ApiCreatedResponse({ type: ReservationResultEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(reserveStockSchema))
  @RequiresPermission('inventory:stock:adjust')
  @Audit({ action: 'CREATE', entityType: 'reservation', captureAfter: true })
  async reserveStockRoute(
    @Body() dto: ReserveStockDto,
  ): Promise<{ data: { reservationId: string; expiresAt: string } }> {
    return {
      data: await this.reserveStock.execute({
        variantId: dto.variantId,
        warehouseId: dto.warehouseId,
        quantity: dto.quantity,
        ...(dto.holdForSeconds !== undefined ? { holdForSeconds: dto.holdForSeconds } : {}),
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        ...(dto.idempotencyKey !== undefined ? { idempotencyKey: dto.idempotencyKey } : {}),
      }),
    };
  }

  @Post('reservations/:id/commit')
  @ApiOkResponse()
  @RequiresPermission('inventory:stock:adjust')
  @Audit({ action: 'UPDATE', entityType: 'reservation' })
  async commitReservationRoute(@Param('id') id: string): Promise<{ data: { movementId: string } }> {
    return { data: await this.commitReservation.execute(id) };
  }

  @Post('reservations/:id/release')
  @ApiOkResponse()
  @RequiresPermission('inventory:stock:adjust')
  @Audit({ action: 'UPDATE', entityType: 'reservation' })
  async releaseReservationRoute(@Param('id') id: string): Promise<{ data: { released: boolean } }> {
    return { data: await this.releaseReservation.execute(id) };
  }

  @Get('stock')
  @ApiOkResponse({ type: StockLevelListEnvelopeResponse })
  @RequiresPermission('inventory:product:read')
  async listStockRoute(): Promise<{ data: { items: Record<string, unknown>[] } }> {
    const rows = await this.listStockLevels.execute();
    return {
      data: {
        items: rows.map((row) => ({
          ...row,
          // INV-5: available = on-hand − reserved (exact decimal arithmetic).
          quantityAvailable: subtractQuantity(row.quantityOnHand, row.quantityReserved),
        })),
      },
    };
  }

  // ─── Warehouses ─────────────────────────────────────────────────────────

  @Get('warehouses')
  @ApiOkResponse({ type: WarehouseListEnvelopeResponse })
  @RequiresPermission('inventory:product:read')
  async listWarehousesRoute(): Promise<{ data: { items: Record<string, unknown>[] } }> {
    const rows = await this.listWarehouses.execute();
    return { data: { items: rows.map((row) => ({ ...row })) } };
  }

  // ─── Stock counts (INV-14) ──────────────────────────────────────────────

  @Get('stock-counts')
  @ApiOkResponse({ type: StockCountListEnvelopeResponse })
  @RequiresPermission('inventory:stock:count')
  async listStockCountsRoute(): Promise<{ data: { items: Record<string, unknown>[] } }> {
    const rows = await this.listStockCounts.execute();
    return { data: { items: rows.map(toStockCountResponse) } };
  }

  @Post('stock-counts')
  @ApiCreatedResponse({ type: StockCountEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(createStockCountSchema))
  @RequiresPermission('inventory:stock:count')
  @Audit({ action: 'CREATE', entityType: 'stock_count', captureAfter: true })
  async createStockCountRoute(@Body() dto: CreateStockCountDto): Promise<{ data: Record<string, unknown> }> {
    const result = await this.createStockCount.execute({
      warehouseId: dto.warehouseId,
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      lines: dto.lines,
    });
    return { data: toStockCountResponse(result) };
  }

  @Post('stock-counts/:id/apply')
  @ApiOkResponse()
  @RequiresPermission('inventory:stock:count')
  @Audit({ action: 'UPDATE', entityType: 'stock_count' })
  async applyStockCountRoute(@Param('id') id: string): Promise<{ data: { correctionsApplied: number } }> {
    return { data: await this.applyStockCount.execute(id) };
  }
}

// ─── Response mappers ─────────────────────────────────────────────────────────
//
// Controllers map domain rows to the wire shape; the zod response schemas
// (and OpenAPI) describe exactly what leaves the API.

function toProductResponse(row: {
  id: string;
  nameI18n: Record<string, string>;
  isActive: boolean;
  variantId: string | null;
  sku: string | null;
  priceAmountMinor: string | null;
  priceCurrency: string | null;
  reorderPoint: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}): Record<string, unknown> {
  return {
    id: row.id,
    nameI18n: row.nameI18n,
    isActive: row.isActive,
    variantId: row.variantId,
    sku: row.sku,
    price: row.priceAmountMinor !== null ? { amountMinor: row.priceAmountMinor, currency: row.priceCurrency } : null,
    reorderPoint: row.reorderPoint,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toStockCountResponse(data: {
  id: string;
  warehouseId: string;
  status: string;
  countedAt: Date | null;
  countedBy: string | null;
  notes: string | null;
  lines: Array<{ id: string; variantId: string; expectedQuantity: string; countedQuantity: string; variance: string }>;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    id: data.id,
    warehouseId: data.warehouseId,
    status: data.status,
    countedAt: data.countedAt?.toISOString() ?? null,
    countedBy: data.countedBy,
    notes: data.notes,
    lines: data.lines.map((line) => ({
      id: line.id,
      variantId: line.variantId,
      expectedQuantity: line.expectedQuantity,
      countedQuantity: line.countedQuantity,
      variance: line.variance,
    })),
    createdAt: data.createdAt.toISOString(),
    updatedAt: data.updatedAt.toISOString(),
  };
}
