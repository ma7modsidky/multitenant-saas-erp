import { MODULE_KEYS, ORGANIZATION_READ_PORT, type OrganizationReadPort } from '@modubiz/contracts';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

import { Audit } from '../../../core/audit/__init__.js';
import { RequiresModule, RequiresPermission } from '../../../core/authorization/__init__.js';
import { ConflictError } from '../../../core/common/errors.js';
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { PortRegistry } from '../../../core/ports/port-registry.js';
import { PublicRoute } from '../../../core/tenancy/system-context.decorator.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
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
} from '../application/index.js';
import { SALE_STATUS } from '../domain/index.js';

import type {
  CheckoutDto,
  CloseShiftDto,
  CreateRegisterDto,
  OpenShiftDto,
  ProcessRefundDto,
  SyncSaleDto,
} from './dto/index.js';
import {
  PosCheckoutEnvelopeResponse,
  PosRefundEnvelopeResponse,
  PosRegisterEnvelopeResponse,
  PosRegisterListEnvelopeResponse,
  PosSaleEnvelopeResponse,
  PosSaleListEnvelopeResponse,
  PosShiftEnvelopeResponse,
  PosShiftListEnvelopeResponse,
  checkoutSchema,
  closeShiftSchema,
  createRegisterSchema,
  openShiftSchema,
  processRefundSchema,
  syncSaleSchema,
} from './dto/index.js';

/**
 * PosController — POS endpoints of the POS bounded context (`/v1/pos/...`).
 *
 * All routes require JWT auth + the `pos` module entitlement (AUTHZ-6) + the
 * matching permission. Controllers validate, resolve platform values (org base
 * currency), delegate to a use case, and map the response — no business logic
 * (hard rule #6).
 *
 * @see POS-3 (open shift), POS-9 (receipts), POS-10 (payments = total),
 *      POS-11 (single currency), POS-15 (stock atomic with the sale),
 *      POS-23 (refund requires open shift + reason)
 */
@Controller('v1/pos')
@UseGuards(AuthGuard('jwt'))
@RequiresModule(MODULE_KEYS.POS)
export class PosController {
  constructor(
    private readonly getStatus: GetStatusUseCase,
    private readonly createRegister: CreateRegisterUseCase,
    private readonly listRegisters: ListRegistersUseCase,
    private readonly openShift: OpenShiftUseCase,
    private readonly closeShift: CloseShiftUseCase,
    private readonly listShifts: ListShiftsUseCase,
    private readonly getShiftReport: GetShiftReportUseCase,
    private readonly checkout: CheckoutUseCase,
    private readonly syncOfflineSale: SyncOfflineSaleUseCase,
    private readonly listSales: ListSalesUseCase,
    private readonly getSale: GetSaleUseCase,
    private readonly voidSale: VoidSaleUseCase,
    private readonly processRefund: ProcessRefundUseCase,
    private readonly portRegistry: PortRegistry,
  ) {}

  /** Public status probe. */
  @PublicRoute()
  @Get('status')
  async status(): Promise<{ data: { module: string; status: string } }> {
    return { data: await this.getStatus.execute() };
  }

  // ─── Registers (POS-1) ─────────────────────────────────────────────────

  @Get('registers')
  @ApiOkResponse({ type: PosRegisterListEnvelopeResponse })
  @RequiresPermission('pos:register:manage')
  async listRegistersRoute(): Promise<{ data: { items: Record<string, unknown>[] } }> {
    const rows = await this.listRegisters.execute();
    return { data: { items: rows.map(toRegisterResponse) } };
  }

  @Post('registers')
  @ApiCreatedResponse({ type: PosRegisterEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(createRegisterSchema))
  @RequiresPermission('pos:register:manage')
  @Audit({ action: 'CREATE', entityType: 'register', captureAfter: true })
  async createRegisterRoute(@Body() dto: CreateRegisterDto): Promise<{ data: Record<string, unknown> }> {
    const result = await this.createRegister.execute({
      name: dto.name,
      code: dto.code,
      warehouseId: dto.warehouseId,
    });
    return { data: { id: result.id, warehouseId: result.warehouseId } };
  }

  // ─── Shifts (POS-2, POS-4, POS-5, POS-7) ────────────────────────────────

  @Post('registers/:id/shifts/open')
  @ApiCreatedResponse({ type: PosShiftEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(openShiftSchema))
  @RequiresPermission('pos:shift:open')
  @Audit({ action: 'CREATE', entityType: 'shift', captureAfter: true })
  async openShiftRoute(
    @Param('id') registerId: string,
    @Body() dto: OpenShiftDto,
  ): Promise<{ data: Record<string, unknown> }> {
    const organizationId = TenantContext.requireOrganizationId();
    // POS-11: the register currency is the org base currency (read port).
    const currency = await this.resolveBaseCurrency(organizationId);
    return {
      data: await this.openShift.execute({
        registerId,
        openingFloatAmountMinor: dto.openingFloatAmountMinor,
        currency,
      }),
    };
  }

  @Post('registers/:id/shifts/close')
  @ApiOkResponse({ type: PosShiftEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(closeShiftSchema))
  @RequiresPermission('pos:shift:close')
  @Audit({ action: 'UPDATE', entityType: 'shift' })
  async closeShiftRoute(
    @Param('id') registerId: string,
    @Body() dto: CloseShiftDto,
  ): Promise<{ data: Record<string, unknown> }> {
    // The open shift id is resolved from the register (a close always targets
    // the currently open shift — POS-5).
    const result = await this.closeShift.executeForRegister(registerId, {
      countedCashAmountMinor: dto.countedCashAmountMinor,
      ...(dto.forcedClose !== undefined ? { forcedClose: dto.forcedClose } : {}),
    });
    return { data: result };
  }

  @Get('shifts')
  @ApiOkResponse({ type: PosShiftListEnvelopeResponse })
  @RequiresPermission('pos:report:view')
  async listShiftsRoute(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ): Promise<{ data: { items: Record<string, unknown>[] } }> {
    // fromDate/toDate are interpolated into `::date` casts in the repository —
    // a strict ISO date check is the injection boundary (mirrors the sales
    // list route).
    if (fromDate !== undefined && !ISO_DATE_RE.test(fromDate)) {
      throw new BadRequestException('fromDate must be an ISO date (YYYY-MM-DD)');
    }
    if (toDate !== undefined && !ISO_DATE_RE.test(toDate)) {
      throw new BadRequestException('toDate must be an ISO date (YYYY-MM-DD)');
    }
    const rows = await this.listShifts.execute({
      ...(fromDate !== undefined ? { fromDate } : {}),
      ...(toDate !== undefined ? { toDate } : {}),
    });
    // Per-shift sales/refund aggregates (POS-8 semantics) let the shifts list
    // show filtered totals without N+1 report fetches.
    return {
      data: {
        items: rows.map((row) => ({
          ...toShiftResponse(row),
          salesCount: row.salesCount,
          salesAmountMinor: row.salesAmountMinor,
          refundsAmountMinor: row.refundsAmountMinor,
        })),
      },
    };
  }

  @Get('shifts/:id/report')
  @ApiOkResponse({ type: PosShiftEnvelopeResponse })
  @RequiresPermission('pos:report:view')
  async shiftReportRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const report = await this.getShiftReport.execute(id);
    return {
      data: {
        shift: toShiftResponse(report.shift),
        totals: report.totals,
        sales: report.sales.map(toSaleResponse),
        refunds: report.refunds.map(toRefundResponse),
      },
    };
  }

  // ─── Sales (POS-9, POS-10, POS-15) ──────────────────────────────────────

  @Post('sales')
  @ApiCreatedResponse({ type: PosCheckoutEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(checkoutSchema))
  @RequiresPermission('pos:sale:create')
  @Audit({ action: 'CREATE', entityType: 'sale', captureAfter: true })
  async checkoutRoute(
    @Body() dto: CheckoutDto,
    @Headers('Idempotency-Key') idempotencyKeyHeader?: string,
  ): Promise<{ data: { saleId: string; receiptNumber: string } }> {
    const organizationId = TenantContext.requireOrganizationId();
    // POS-26: idempotency keys are client-generated UUIDs. The body schema
    // validates the body path; the header path is validated here so a
    // malformed header is a clean 400, never a DB error on the uuid column.
    const idempotencyKey = dto.idempotencyKey ?? idempotencyKeyHeader;
    if (idempotencyKey !== undefined && !isUuid(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key must be a UUID (POS-26)');
    }
    // POS-11: the register currency is the org base currency (read port).
    const currency = await this.resolveBaseCurrency(organizationId);
    return {
      data: await this.checkout.execute({
        registerId: dto.registerId,
        currency,
        locale: dto.locale,
        lines: dto.lines.map(toLineInput),
        payments: dto.payments.map(toPaymentInput),
        ...(dto.customerContactId !== undefined ? { customerContactId: dto.customerContactId } : {}),
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      }),
    };
  }

  /** Offline sync (POS-26/27/29) — a retry returns the original sale. */
  @Post('sales/sync')
  @ApiCreatedResponse({ type: PosCheckoutEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(syncSaleSchema))
  @RequiresPermission('pos:sale:create')
  @Audit({ action: 'CREATE', entityType: 'sale', captureAfter: true })
  async syncSaleRoute(@Body() dto: SyncSaleDto): Promise<{ data: Record<string, unknown> }> {
    const organizationId = TenantContext.requireOrganizationId();
    const currency = await this.resolveBaseCurrency(organizationId);
    const result = await this.syncOfflineSale.execute({
      clientDeviceId: dto.clientDeviceId,
      idempotencyKey: dto.idempotencyKey,
      registerId: dto.registerId,
      currency,
      locale: dto.locale,
      soldAt: dto.soldAt,
      lines: dto.lines.map(toLineInput),
      payments: dto.payments.map(toPaymentInput),
      ...(dto.customerContactId !== undefined ? { customerContactId: dto.customerContactId } : {}),
    });
    // POS-28/29: a rejected sync was RECORDED in pos_sync_log, but the client
    // must see the failure — surface the machine-readable code, never a silent
    // 200 (the offline outbox keeps retrying until the stock condition clears).
    if (result.rejected) {
      throw new ConflictError(result.errorCode ?? 'POS_SYNC_REJECTED', 'Offline sale rejected (POS-28).', {
        idempotencyKey: dto.idempotencyKey,
      });
    }
    return {
      data: {
        saleId: result.saleId,
        receiptNumber: result.receiptNumber,
        replay: result.replay,
      },
    };
  }

  @Get('sales')
  @ApiOkResponse({ type: PosSaleListEnvelopeResponse })
  @RequiresPermission('pos:report:view')
  async listSalesRoute(
    @Query('status') status?: string,
    @Query('shiftId') shiftId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{
    data: {
      items: Record<string, unknown>[];
      total: number;
      totalAmountMinor: string;
      refundsAmountMinor: string;
      page: number;
      pageSize: number;
    };
  }> {
    // POS-13 status vocabulary — a comma-separated list is allowed (e.g.
    // "completed,partially_refunded" for revenue sums); every token is
    // validated, anything else is a 400, never an empty page.
    const statuses = parseSaleStatuses(status);
    if (shiftId !== undefined && !isUuid(shiftId)) {
      throw new BadRequestException('shiftId must be a UUID');
    }
    // fromDate/toDate are interpolated into `::date` casts in the repository —
    // a strict ISO date check is the injection boundary (mirrors the inventory
    // and CRM list routes).
    if (fromDate !== undefined && !ISO_DATE_RE.test(fromDate)) {
      throw new BadRequestException('fromDate must be an ISO date (YYYY-MM-DD)');
    }
    if (toDate !== undefined && !ISO_DATE_RE.test(toDate)) {
      throw new BadRequestException('toDate must be an ISO date (YYYY-MM-DD)');
    }
    const pageNum = parsePage(page);
    const pageSizeNum = parsePage(pageSize);
    const result = await this.listSales.execute({
      ...(statuses !== undefined ? { statuses } : {}),
      ...(shiftId !== undefined ? { shiftId } : {}),
      ...(fromDate !== undefined ? { fromDate } : {}),
      ...(toDate !== undefined ? { toDate } : {}),
      ...(pageNum !== undefined ? { page: pageNum } : {}),
      ...(pageSizeNum !== undefined ? { pageSize: pageSizeNum } : {}),
    });
    return {
      data: {
        items: result.items.map(toSaleResponse),
        total: result.total,
        // Exact Σ of the matching sales (ignoring pagination) — the reports
        // page shows filtered totals without summing the current page.
        totalAmountMinor: result.totalAmountMinor,
        // Σ refunds issued in the same window against matching sales — net
        // revenue = totalAmountMinor − refundsAmountMinor (dashboard stat).
        refundsAmountMinor: result.refundsAmountMinor,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  }

  @Get('sales/:id')
  @ApiOkResponse({ type: PosSaleEnvelopeResponse })
  @RequiresPermission('pos:report:view')
  async getSaleRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const sale = await this.getSale.execute(id);
    return { data: toSaleResponse(sale) };
  }

  @Post('sales/:id/void')
  @ApiOkResponse({ type: PosSaleEnvelopeResponse })
  @RequiresPermission('pos:sale:create')
  @Audit({ action: 'UPDATE', entityType: 'sale' })
  async voidSaleRoute(@Param('id') id: string): Promise<{ data: { saleId: string; status: string } }> {
    return { data: await this.voidSale.execute(id) };
  }

  // ─── Refunds (POS-20 → POS-24) ─────────────────────────────────────────

  @Post('refunds')
  @ApiCreatedResponse({ type: PosRefundEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(processRefundSchema))
  @RequiresPermission('pos:refund:process')
  @Audit({ action: 'CREATE', entityType: 'refund', captureAfter: true })
  async processRefundRoute(@Body() dto: ProcessRefundDto): Promise<{ data: Record<string, unknown> }> {
    const organizationId = TenantContext.requireOrganizationId();
    const currency = await this.resolveBaseCurrency(organizationId);
    return {
      data: await this.processRefund.execute({
        originalSaleId: dto.originalSaleId,
        registerId: dto.registerId,
        reasonCode: dto.reasonCode,
        currency,
        lines: dto.lines.map((line) => ({
          saleLineId: line.saleLineId,
          variantId: line.variantId,
          quantity: line.quantity,
          restock: line.restock,
          amountMinor: line.amount.amountMinor,
          currency: line.currency,
        })),
      }),
    };
  }

  // ─── Platform read ports ────────────────────────────────────────────────

  private async resolveBaseCurrency(organizationId: string): Promise<string> {
    const orgPort = this.portRegistry.resolve<OrganizationReadPort>(ORGANIZATION_READ_PORT);
    return orgPort.getBaseCurrency(organizationId);
  }
}

// ─── Input mappers ──────────────────────────────────────────────────────────

// The checkout and sync DTOs share the same line/payment shapes (both are
// inferred from the same zod schemas), so one input type serves both routes.
type SaleLineDto = CheckoutDto['lines'][number];
type PaymentDto = CheckoutDto['payments'][number];

function toLineInput(line: SaleLineDto): {
  variantId: string;
  sku: string;
  nameI18n: Record<string, string>;
  quantity: string;
  unitPriceAmountMinor: string;
  lineDiscountAmountMinor: string;
  taxRateBp: number;
  currency: string;
} {
  return {
    variantId: line.variantId,
    sku: line.sku,
    nameI18n: line.nameI18n,
    quantity: line.quantity,
    unitPriceAmountMinor: line.unitPrice.amountMinor,
    lineDiscountAmountMinor: line.lineDiscount?.amountMinor ?? '0',
    taxRateBp: line.taxRateBp,
    currency: line.currency,
  };
}

function toPaymentInput(payment: PaymentDto): {
  method: 'cash' | 'card' | 'other';
  amountMinor: string;
  currency: string;
  tenderedAmountMinor?: string;
  changeAmountMinor?: string;
  reference?: string | null;
} {
  return {
    method: payment.method,
    amountMinor: payment.amount.amountMinor,
    currency: payment.currency,
    ...(payment.tenderedAmountMinor !== undefined ? { tenderedAmountMinor: payment.tenderedAmountMinor } : {}),
    ...(payment.changeAmountMinor !== undefined ? { changeAmountMinor: payment.changeAmountMinor } : {}),
    ...(payment.reference !== undefined ? { reference: payment.reference } : {}),
  };
}

// ─── Response mappers ───────────────────────────────────────────────────────

function toRegisterResponse(row: {
  id: string;
  name: string;
  code: string;
  warehouseId: string;
  receiptPrefix: string;
  isActive: boolean;
  openShiftId: string | null;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    warehouseId: row.warehouseId,
    receiptPrefix: row.receiptPrefix,
    isActive: row.isActive,
    openShiftId: row.openShiftId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toShiftResponse(row: {
  id: string;
  registerId: string;
  openedBy: string;
  openedAt: Date;
  openingFloatAmountMinor: string;
  closedBy: string | null;
  closedAt: Date | null;
  countedCashAmountMinor: string | null;
  expectedCashAmountMinor: string | null;
  varianceAmountMinor: string | null;
  currency: string;
  status: string;
  forcedClose: boolean;
}): Record<string, unknown> {
  return {
    id: row.id,
    registerId: row.registerId,
    openedBy: row.openedBy,
    openedAt: row.openedAt.toISOString(),
    openingFloatAmountMinor: row.openingFloatAmountMinor,
    closedBy: row.closedBy,
    closedAt: row.closedAt?.toISOString() ?? null,
    countedCashAmountMinor: row.countedCashAmountMinor,
    expectedCashAmountMinor: row.expectedCashAmountMinor,
    varianceAmountMinor: row.varianceAmountMinor,
    currency: row.currency,
    status: row.status,
    forcedClose: row.forcedClose,
  };
}

function toSaleResponse(row: {
  id: string;
  shiftId: string;
  registerId: string;
  receiptNumber: string;
  status: string;
  subtotalAmountMinor: string;
  discountAmountMinor: string;
  taxAmountMinor: string;
  totalAmountMinor: string;
  currency: string;
  locale: string;
  soldAt: Date;
  createdAt: Date;
  customerContactId: string | null;
  lines: unknown[];
  payments: unknown[];
}): Record<string, unknown> {
  return {
    id: row.id,
    shiftId: row.shiftId,
    registerId: row.registerId,
    receiptNumber: row.receiptNumber,
    status: row.status,
    subtotal: { amountMinor: row.subtotalAmountMinor, currency: row.currency },
    discount: { amountMinor: row.discountAmountMinor, currency: row.currency },
    tax: { amountMinor: row.taxAmountMinor, currency: row.currency },
    total: { amountMinor: row.totalAmountMinor, currency: row.currency },
    currency: row.currency,
    locale: row.locale,
    customerContactId: row.customerContactId,
    soldAt: row.soldAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    lines: row.lines,
    payments: row.payments,
  };
}

function toRefundResponse(row: {
  id: string;
  originalSaleId: string;
  reasonCode: string;
  amountMinor: string;
  currency: string;
  refundedAt: Date;
}): Record<string, unknown> {
  return {
    id: row.id,
    originalSaleId: row.originalSaleId,
    reasonCode: row.reasonCode,
    amount: { amountMinor: row.amountMinor, currency: row.currency },
    refundedAt: row.refundedAt.toISOString(),
  };
}

/** `page`/`pageSize` query → positive integer; NaN/0/negative is a 400. */
function parsePage(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException('page and pageSize must be positive integers');
  return n;
}

/**
 * `status` query → allow-listed statuses (POS-13). Accepts a comma-separated
 * list (`completed,partially_refunded`) and dedupes; any unknown token is a
 * 400 so an invalid filter never silently returns an empty page.
 */
function parseSaleStatuses(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const statuses = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (statuses.length === 0 || statuses.some((s) => !SALE_STATUS_VALUES.includes(s))) {
    throw new BadRequestException(`status must be one of: ${SALE_STATUS_VALUES.join(', ')}`);
  }
  return [...new Set(statuses)];
}

/** The immutable sale status vocabulary (POS-13) — used to allow-list filters. */
const SALE_STATUS_VALUES: readonly string[] = Object.values(SALE_STATUS);

/** Strict ISO date (YYYY-MM-DD) for sold_at range filters. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * UUID check for header/query idempotency + id filters.
 *
 * Reuses the same validator the body schemas use (`z.string().uuid()`) so a
 * header-supplied key and a body-supplied key accept exactly the same set — a
 * value that passes here passes the DTO, and vice versa (POS-26).
 */
function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}
