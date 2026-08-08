import { MODULE_KEYS } from '@modubiz/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresModule, RequiresPermission } from '../../../core/authorization/__init__.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { PublicRoute } from '../../../core/tenancy/system-context.decorator.js';
import { MOVEMENT_TYPE, subtractQuantity, type MovementType } from '../domain/index.js';
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
} from '../application/index.js';

import {
  AddVariantDto,
  AddVariantResultEnvelopeResponse,
  AdjustStockDto,
  CreateProductDto,
  CreateStockCountDto,
  CreateWarehouseDto,
  MovementListEnvelopeResponse,
  MovementResultEnvelopeResponse,
  ProductDetailEnvelopeResponse,
  ProductEnvelopeResponse,
  ProductListEnvelopeResponse,
  ReceiveStockDto,
  ReservationListEnvelopeResponse,
  ReservationResultEnvelopeResponse,
  ReserveStockDto,
  StockCountDetailEnvelopeResponse,
  StockCountEnvelopeResponse,
  StockCountListEnvelopeResponse,
  StockLevelListEnvelopeResponse,
  TransferStockDto,
  UpdateProductDto,
  UpdateVariantDto,
  VariantListEnvelopeResponse,
  WarehouseEnvelopeResponse,
  WarehouseListEnvelopeResponse,
  addVariantSchema,
  adjustStockSchema,
  createProductSchema,
  createStockCountSchema,
  createWarehouseSchema,
  receiveStockSchema,
  reserveStockSchema,
  transferStockSchema,
  updateProductSchema,
  updateVariantSchema,
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
    private readonly getProduct: GetProductUseCase,
    private readonly listWarehouses: ListWarehousesUseCase,
    private readonly listStockLevels: ListStockLevelsUseCase,
    private readonly listMovements: ListMovementsUseCase,
    private readonly listStockCounts: ListStockCountsUseCase,
    private readonly createProduct: CreateProductUseCase,
    private readonly updateProduct: UpdateProductUseCase,
    private readonly addVariant: AddVariantUseCase,
    private readonly updateVariant: UpdateVariantUseCase,
    private readonly archiveProduct: ArchiveProductUseCase,
    private readonly archiveVariant: ArchiveVariantUseCase,
    private readonly unarchiveProduct: UnarchiveProductUseCase,
    private readonly unarchiveVariant: UnarchiveVariantUseCase,
    private readonly listVariants: ListVariantsUseCase,
    private readonly createWarehouse: CreateWarehouseUseCase,
    private readonly listReservations: ListReservationsUseCase,
    private readonly getStockCount: GetStockCountUseCase,
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
  async listProductsRoute(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: { items: Record<string, unknown>[]; total: number; page: number; pageSize: number } }> {
    if (status !== undefined && status !== 'active' && status !== 'archived') {
      throw new BadRequestException('status must be active or archived');
    }
    const pageNum = parsePage(page);
    const pageSizeNum = parsePage(pageSize);
    const result = await this.listProducts.execute({
      ...(search !== undefined ? { search } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(pageNum !== undefined ? { page: pageNum } : {}),
      ...(pageSizeNum !== undefined ? { pageSize: pageSizeNum } : {}),
    });
    return {
      data: {
        items: result.items.map(toProductResponse),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
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

  @Get('products/:id')
  @ApiOkResponse({ type: ProductDetailEnvelopeResponse })
  @RequiresPermission('inventory:product:read')
  async getProductRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.getProduct.execute(id);
    return { data: toProductDetailResponse(result) };
  }

  @Post('products/:id/variants')
  @ApiCreatedResponse({ type: AddVariantResultEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(addVariantSchema))
  @RequiresPermission('inventory:product:write')
  @Audit({ action: 'CREATE', entityType: 'product_variant', captureAfter: true })
  async addVariantRoute(@Param('id') id: string, @Body() dto: AddVariantDto): Promise<{ data: { variantId: string } }> {
    return {
      data: await this.addVariant.execute({
        productId: id,
        sku: dto.sku,
        barcode: dto.barcode ?? null,
        priceAmountMinor: dto.price.amountMinor,
        priceCurrency: dto.price.currency,
        costAmountMinor: dto.cost.amountMinor,
        costCurrency: dto.cost.currency,
        reorderPoint: dto.reorderPoint,
        reorderQuantity: dto.reorderQuantity,
      }),
    };
  }

  @Patch('products/:id')
  @ApiOkResponse()
  @UsePipes(new ZodValidationPipe(updateProductSchema))
  @RequiresPermission('inventory:product:write')
  @Audit({ action: 'UPDATE', entityType: 'product' })
  async updateProductRoute(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<{ data: { productId: string; updatedAt: string } }> {
    return {
      data: await this.updateProduct.execute(id, {
        ...(dto.nameI18n !== undefined ? { nameI18n: dto.nameI18n } : {}),
        ...(dto.descriptionI18n !== undefined ? { descriptionI18n: dto.descriptionI18n } : {}),
      }),
    };
  }

  @Post('products/:id/archive')
  @ApiOkResponse()
  @RequiresPermission('inventory:product:write')
  @Audit({ action: 'UPDATE', entityType: 'product' })
  async archiveProductRoute(@Param('id') id: string): Promise<{ data: { archivedAt: string } }> {
    return { data: await this.archiveProduct.execute(id) };
  }

  @Patch('variants/:id')
  @ApiOkResponse()
  @UsePipes(new ZodValidationPipe(updateVariantSchema))
  @RequiresPermission('inventory:product:write')
  @Audit({ action: 'UPDATE', entityType: 'product_variant' })
  async updateVariantRoute(
    @Param('id') id: string,
    @Body() dto: UpdateVariantDto,
  ): Promise<{ data: { variantId: string; updatedAt: string } }> {
    return {
      data: await this.updateVariant.execute(id, {
        ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
        ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
        ...(dto.price !== undefined
          ? { priceAmountMinor: dto.price.amountMinor, priceCurrency: dto.price.currency }
          : {}),
        ...(dto.cost !== undefined ? { costAmountMinor: dto.cost.amountMinor, costCurrency: dto.cost.currency } : {}),
        ...(dto.reorderPoint !== undefined ? { reorderPoint: dto.reorderPoint } : {}),
        ...(dto.reorderQuantity !== undefined ? { reorderQuantity: dto.reorderQuantity } : {}),
      }),
    };
  }

  @Post('variants/:id/archive')
  @ApiOkResponse()
  @RequiresPermission('inventory:product:write')
  @Audit({ action: 'UPDATE', entityType: 'product_variant' })
  async archiveVariantRoute(@Param('id') id: string): Promise<{ data: { archivedAt: string } }> {
    return { data: await this.archiveVariant.execute(id) };
  }

  @Post('products/:id/unarchive')
  @ApiOkResponse()
  @RequiresPermission('inventory:product:write')
  @Audit({ action: 'RESTORE', entityType: 'product' })
  async unarchiveProductRoute(@Param('id') id: string): Promise<{ data: { restoredAt: string } }> {
    return { data: await this.unarchiveProduct.execute(id) };
  }

  @Post('variants/:id/unarchive')
  @ApiOkResponse()
  @RequiresPermission('inventory:product:write')
  @Audit({ action: 'RESTORE', entityType: 'product_variant' })
  async unarchiveVariantRoute(@Param('id') id: string): Promise<{ data: { restoredAt: string } }> {
    return { data: await this.unarchiveVariant.execute(id) };
  }

  // ─── Variants (pickers — every sellable unit, not just the display one) ──

  @Get('variants')
  @ApiOkResponse({ type: VariantListEnvelopeResponse })
  @RequiresPermission('inventory:product:read')
  async listVariantsRoute(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: { items: Record<string, unknown>[]; total: number; page: number; pageSize: number } }> {
    const pageNum = parsePage(page);
    const pageSizeNum = parsePage(pageSize);
    const result = await this.listVariants.execute({
      ...(search !== undefined ? { search } : {}),
      ...(pageNum !== undefined ? { page: pageNum } : {}),
      ...(pageSizeNum !== undefined ? { pageSize: pageSizeNum } : {}),
    });
    return {
      data: {
        items: result.items.map((row) => ({ ...row })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
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
  async listStockRoute(
    @Query('search') search?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('lowStock') lowStock?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: { items: Record<string, unknown>[]; total: number; page: number; pageSize: number } }> {
    if (warehouseId !== undefined && !UUID_RE.test(warehouseId)) {
      throw new BadRequestException('warehouseId must be a valid UUID');
    }
    const lowStockFlag = parseLowStock(lowStock);
    const pageNum = parsePage(page);
    const pageSizeNum = parsePage(pageSize);
    const result = await this.listStockLevels.execute({
      ...(search !== undefined ? { search } : {}),
      ...(warehouseId !== undefined ? { warehouseId } : {}),
      ...(lowStockFlag !== undefined ? { lowStock: lowStockFlag } : {}),
      ...(pageNum !== undefined ? { page: pageNum } : {}),
      ...(pageSizeNum !== undefined ? { pageSize: pageSizeNum } : {}),
    });
    return {
      data: {
        items: result.items.map(toStockLevelResponse),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  }

  @Get('stock/movements')
  @ApiOkResponse({ type: MovementListEnvelopeResponse })
  @RequiresPermission('inventory:product:read')
  async listMovementsRoute(
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: { items: Record<string, unknown>[]; total: number; page: number; pageSize: number } }> {
    // INV-1: the ledger is append-only — this view is read-only.
    if (type !== undefined && !Object.values(MOVEMENT_TYPE).includes(type as MovementType)) {
      throw new BadRequestException(`type must be one of ${Object.values(MOVEMENT_TYPE).join(', ')}`);
    }
    if (fromDate !== undefined && !ISO_DATE_RE.test(fromDate)) {
      throw new BadRequestException('fromDate must be an ISO date (YYYY-MM-DD)');
    }
    if (toDate !== undefined && !ISO_DATE_RE.test(toDate)) {
      throw new BadRequestException('toDate must be an ISO date (YYYY-MM-DD)');
    }
    const pageNum = parsePage(page);
    const pageSizeNum = parsePage(pageSize);
    const result = await this.listMovements.execute({
      ...(search !== undefined ? { search } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(fromDate !== undefined ? { fromDate } : {}),
      ...(toDate !== undefined ? { toDate } : {}),
      ...(pageNum !== undefined ? { page: pageNum } : {}),
      ...(pageSizeNum !== undefined ? { pageSize: pageSizeNum } : {}),
    });
    return {
      data: {
        items: result.items.map(toMovementResponse),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
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

  @Post('warehouses')
  @ApiCreatedResponse({ type: WarehouseEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(createWarehouseSchema))
  @RequiresPermission('inventory:warehouse:write')
  @Audit({ action: 'CREATE', entityType: 'warehouse', captureAfter: true })
  async createWarehouseRoute(@Body() dto: CreateWarehouseDto): Promise<{ data: Record<string, unknown> }> {
    const row = await this.createWarehouse.execute({
      name: dto.name,
      code: dto.code,
      ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
    });
    return { data: { ...row } };
  }

  // ─── Reservations (INV-5, INV-7, INV-8) ─────────────────────────────────

  @Get('reservations')
  @ApiOkResponse({ type: ReservationListEnvelopeResponse })
  @RequiresPermission('inventory:product:read')
  async listReservationsRoute(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: { items: Record<string, unknown>[]; total: number; page: number; pageSize: number } }> {
    if (status !== undefined && !(RESERVATION_STATES as readonly string[]).includes(status)) {
      throw new BadRequestException(`status must be one of ${RESERVATION_STATES.join(', ')}`);
    }
    const pageNum = parsePage(page);
    const pageSizeNum = parsePage(pageSize);
    const result = await this.listReservations.execute({
      ...(status !== undefined ? { status: status as ReservationState } : {}),
      ...(pageNum !== undefined ? { page: pageNum } : {}),
      ...(pageSizeNum !== undefined ? { pageSize: pageSizeNum } : {}),
    });
    return {
      data: {
        items: result.items.map((row) => ({ ...row })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  }

  // ─── Stock counts (INV-14) ──────────────────────────────────────────────

  @Get('stock-counts')
  @ApiOkResponse({ type: StockCountListEnvelopeResponse })
  @RequiresPermission('inventory:stock:count')
  async listStockCountsRoute(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: { items: Record<string, unknown>[]; total: number; page: number; pageSize: number } }> {
    if (status !== undefined && status !== 'draft' && status !== 'applied') {
      throw new BadRequestException('status must be draft or applied');
    }
    const pageNum = parsePage(page);
    const pageSizeNum = parsePage(pageSize);
    const result = await this.listStockCounts.execute({
      ...(status !== undefined ? { status } : {}),
      ...(pageNum !== undefined ? { page: pageNum } : {}),
      ...(pageSizeNum !== undefined ? { pageSize: pageSizeNum } : {}),
    });
    return {
      data: {
        items: result.items.map(toStockCountResponse),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  }

  @Get('stock-counts/:id')
  @ApiOkResponse({ type: StockCountDetailEnvelopeResponse })
  @RequiresPermission('inventory:stock:count')
  async getStockCountRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    return { data: { ...(await this.getStockCount.execute(id)) } };
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
  variantCount: number;
  variants: Array<{
    id: string;
    sku: string;
    priceAmountMinor: string;
    priceCurrency: string;
    reorderPoint: string;
    isActive: boolean;
  }>;
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
    variantCount: row.variantCount,
    // Every variant (active + archived), primary first — the grouped table.
    variants: row.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      price: { amountMinor: variant.priceAmountMinor, currency: variant.priceCurrency },
      reorderPoint: variant.reorderPoint,
      isActive: variant.isActive,
    })),
  };
}

/**
 * Maps the get-product result to the wire shape (product + variants with
 * nested price/cost + per-warehouse stock + movement history).
 */
function toProductDetailResponse(result: {
  product: {
    id: string;
    nameI18n: Record<string, string>;
    descriptionI18n: Record<string, string>;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
  variants: Array<{
    id: string;
    productId: string;
    sku: string;
    barcode: string | null;
    priceAmountMinor: string;
    priceCurrency: string;
    costAmountMinor: string;
    costCurrency: string;
    reorderPoint: string;
    reorderQuantity: string;
    isActive: boolean;
    /** Optional — ProductVariantData declares the stamps optional. */
    createdByUserId?: string | null;
    updatedByUserId?: string | null;
    stock: Array<{
      variantId: string;
      sku: string;
      productId: string;
      nameI18n: Record<string, string>;
      warehouseId: string | null;
      warehouseName: string | null;
      quantityOnHand: string;
      quantityReserved: string;
      reorderPoint: string;
      lastMovementId: string | null;
      unitCostAmountMinor: string | null;
      unitCostCurrency: string | null;
    }>;
  }>;
  movements: Array<{
    id: string;
    type: string;
    variantId: string;
    sku: string;
    nameI18n: Record<string, string>;
    warehouseId: string | null;
    warehouseName: string | null;
    quantity: string;
    unitCostAmountMinor: string | null;
    unitCostCurrency: string | null;
    referenceType: string;
    referenceId: string;
    reasonCode: string | null;
    occurredAt: string;
    createdBy: string | null;
  }>;
}): Record<string, unknown> {
  return {
    product: { ...result.product },
    variants: result.variants.map((variant) => ({
      id: variant.id,
      productId: variant.productId,
      sku: variant.sku,
      barcode: variant.barcode,
      price: { amountMinor: variant.priceAmountMinor, currency: variant.priceCurrency },
      cost: { amountMinor: variant.costAmountMinor, currency: variant.costCurrency },
      reorderPoint: variant.reorderPoint,
      reorderQuantity: variant.reorderQuantity,
      isActive: variant.isActive,
      // The detail schema declares these stamps; the mapper must surface them
      // or the detail view renders "Created by —" for every variant.
      createdByUserId: variant.createdByUserId ?? null,
      updatedByUserId: variant.updatedByUserId ?? null,
      stock: variant.stock.map((row) => toStockLevelResponse(row)),
    })),
    movements: result.movements.map((row) => toMovementResponse(row)),
  };
}

function toStockLevelResponse(row: {
  variantId: string;
  sku: string;
  productId: string;
  nameI18n: Record<string, string>;
  warehouseId: string | null;
  warehouseName: string | null;
  quantityOnHand: string;
  quantityReserved: string;
  reorderPoint: string;
  lastMovementId: string | null;
  unitCostAmountMinor: string | null;
  unitCostCurrency: string | null;
}): Record<string, unknown> {
  return {
    variantId: row.variantId,
    sku: row.sku,
    productId: row.productId,
    nameI18n: row.nameI18n,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
    quantityOnHand: row.quantityOnHand,
    quantityReserved: row.quantityReserved,
    // INV-5: available = on-hand − reserved (exact decimal arithmetic).
    quantityAvailable: subtractQuantity(row.quantityOnHand, row.quantityReserved),
    reorderPoint: row.reorderPoint,
    lastMovementId: row.lastMovementId,
    unitCost:
      row.unitCostAmountMinor !== null && row.unitCostCurrency !== null
        ? { amountMinor: row.unitCostAmountMinor, currency: row.unitCostCurrency }
        : null,
  };
}

function toMovementResponse(row: {
  id: string;
  type: string;
  /** Owning variant — the transfers view pairs movements by variant for repeat. */
  variantId: string;
  sku: string;
  nameI18n: Record<string, string>;
  warehouseId: string | null;
  warehouseName: string | null;
  quantity: string;
  unitCostAmountMinor: string | null;
  unitCostCurrency: string | null;
  referenceType: string;
  referenceId: string;
  reasonCode: string | null;
  occurredAt: string;
  createdBy: string | null;
}): Record<string, unknown> {
  return {
    id: row.id,
    type: row.type,
    variantId: row.variantId,
    sku: row.sku,
    nameI18n: row.nameI18n,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
    quantity: row.quantity,
    unitCost:
      row.unitCostAmountMinor !== null && row.unitCostCurrency !== null
        ? { amountMinor: row.unitCostAmountMinor, currency: row.unitCostCurrency }
        : null,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    reasonCode: row.reasonCode,
    occurredAt: row.occurredAt,
    createdBy: row.createdBy,
  };
}

// ─── Query-param validation helpers ──────────────────────────────────────────
//
// Every query param is interpolated into SQL, so malformed values must surface
// as 400 (ERR-1/ERR-6), never as a 500. All are validated before the use case.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RESERVATION_STATES = ['held', 'committed', 'released', 'expired'] as const;
type ReservationState = (typeof RESERVATION_STATES)[number];

/** `lowStock` query → boolean; anything but true/false/1/0 is a 400. */
function parseLowStock(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new BadRequestException('lowStock must be true or false');
}

/** `page`/`pageSize` query → positive integer; NaN/0/negative is a 400. */
function parsePage(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException('page and pageSize must be positive integers');
  return n;
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
