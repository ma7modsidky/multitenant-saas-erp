import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
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
import { ZodValidationPipe } from '../../../core/common/zod-validation.pipe.js';
import { PublicRoute } from '../../../core/tenancy/system-context.decorator.js';
import { MODULE_KEYS } from '@modubiz/contracts';
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
} from '../application/index.js';
import {
  approveSchema,
  createBillSchema,
  createPurchaseOrderSchema,
  createSupplierReturnSchema,
  createSupplierSchema,
  receiveGrnSchema,
  recordPaymentSchema,
  submitRequisitionSchema,
  updateSupplierSchema,
  type ApproveDto,
  type CreateBillDto,
  type CreatePurchaseOrderDto,
  type CreateSupplierDto,
  type CreateSupplierReturnDto,
  type ReceiveGrnDto,
  type RecordPaymentDto,
  type SubmitRequisitionDto,
  type UpdateSupplierDto,
  BillEnvelopeResponse,
  BillListEnvelopeResponse,
  GrnEnvelopeResponse,
  GrnListEnvelopeResponse,
  PaymentDetailEnvelopeResponse,
  PaymentEnvelopeResponse,
  PaymentListEnvelopeResponse,
  PurchaseOrderDetailEnvelopeResponse,
  PurchaseOrderEnvelopeResponse,
  PurchaseOrderListEnvelopeResponse,
  RequisitionEnvelopeResponse,
  SupplierEnvelopeResponse,
  SupplierListEnvelopeResponse,
  SupplierReturnDetailEnvelopeResponse,
  SupplierReturnEnvelopeResponse,
  SupplierReturnListEnvelopeResponse,
  VendorBalancesEnvelopeResponse,
} from './dto/index.js';
import type {
  BillLineInput,
  GrnLineInput,
  PaymentTerms,
  PoLineInput,
  RequisitionLineInput,
  SupplierReturnLineInput,
} from '../domain/index.js';

/**
 * Purchasing controller. No business logic — validate, delegate, map, return.
 *
 * Every route is guarded by @RequiresModule(MODULE_KEYS.PURCHASING) and
 * @RequiresPermission. Money arrives as integer minor-unit strings (hard
 * rule #3). PUR-13 idempotency keys are read from the `Idempotency-Key`
 * header on the mutating routes that need them (GRN, bill, payment, return).
 *
 * @see PUR-1 (suppliers), PUR-3 (POs), PUR-4 (GRN→stock), PUR-6 (three-way
 *      match), PUR-7 (payments), PUR-11 (returns), PUR-12 (approvals)
 */
@Controller('v1/purchasing')
@UseGuards(AuthGuard('jwt'))
@RequiresModule(MODULE_KEYS.PURCHASING)
export class PurchasingController {
  constructor(
    private readonly getStatus: GetStatusUseCase,
    private readonly createSupplier: CreateSupplierUseCase,
    private readonly createBill: CreateBillUseCase,
    private readonly createSupplierReturn: CreateSupplierReturnUseCase,
    private readonly updateSupplier: UpdateSupplierUseCase,
    private readonly listSuppliers: ListSuppliersUseCase,
    private readonly getSupplier: GetSupplierUseCase,
    private readonly submitRequisition: SubmitRequisitionUseCase,
    private readonly approveRequisition: ApproveRequisitionUseCase,
    private readonly createPurchaseOrder: CreatePurchaseOrderUseCase,
    private readonly approvePurchaseOrder: ApprovePurchaseOrderUseCase,
    private readonly listPurchaseOrders: ListPurchaseOrdersUseCase,
    private readonly getPurchaseOrder: GetPurchaseOrderUseCase,
    private readonly receiveGrn: ReceiveGrnUseCase,
    private readonly listGrns: ListGrnsUseCase,
    private readonly getGrn: GetGrnUseCase,
    private readonly approveBill: ApproveBillUseCase,
    private readonly listBills: ListBillsUseCase,
    private readonly getBill: GetBillUseCase,
    private readonly recordPayment: RecordSupplierPaymentUseCase,
    private readonly listPayments: ListPaymentsUseCase,
    private readonly getPayment: GetPaymentUseCase,
    private readonly approveSupplierReturn: ApproveSupplierReturnUseCase,
    private readonly listSupplierReturns: ListSupplierReturnsUseCase,
    private readonly getSupplierReturn: GetSupplierReturnUseCase,
    private readonly getVendorBalances: GetVendorBalancesUseCase,
  ) {}

  /** Public status probe. */
  @PublicRoute()
  @Get('status')
  async status(): Promise<{ data: { module: string; status: string } }> {
    return { data: await this.getStatus.execute() };
  }

  // ─── Suppliers (PUR-1) ─────────────────────────────────────────────────

  @Post('suppliers')
  @ApiCreatedResponse({ type: SupplierEnvelopeResponse })
  @RequiresPermission('purchasing:supplier:write')
  @Audit({ action: 'CREATE', entityType: 'supplier', captureAfter: true })
  @UsePipes(new ZodValidationPipe(createSupplierSchema))
  async createSupplierRoute(@Body() dto: CreateSupplierDto): Promise<{ data: Record<string, unknown> }> {
    const result = await this.createSupplier.execute({
      name: dto.name,
      ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
      ...(dto.paymentTerms !== undefined ? { paymentTerms: paymentTermsFromDto(dto.paymentTerms) } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.contactName !== undefined ? { contactName: dto.contactName } : {}),
      ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail } : {}),
      ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
      ...(dto.address !== undefined ? { address: dto.address } : {}),
      ...(dto.bankAccount !== undefined ? { bankAccount: dto.bankAccount } : {}),
    });
    return { data: result };
  }

  @Get('suppliers')
  @ApiOkResponse({ type: SupplierListEnvelopeResponse })
  @RequiresPermission('purchasing:supplier:read')
  async listSuppliersRoute(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const result = await this.listSuppliers.execute(filterFromQuery({ q, page, pageSize }));
    return { data: result as unknown as Record<string, unknown> };
  }

  @Get('suppliers/:id')
  @ApiOkResponse({ type: SupplierEnvelopeResponse })
  @RequiresPermission('purchasing:supplier:read')
  async getSupplierRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.getSupplier.execute({ supplierId: id });
    return { data: result as unknown as Record<string, unknown> };
  }

  @Patch('suppliers/:id')
  @ApiOkResponse({ type: SupplierEnvelopeResponse })
  @RequiresPermission('purchasing:supplier:write')
  @Audit({ action: 'UPDATE', entityType: 'supplier', captureBefore: true, captureAfter: true })
  @UsePipes(new ZodValidationPipe(updateSupplierSchema))
  async updateSupplierRoute(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ): Promise<{ data: Record<string, unknown> }> {
    const result = await this.updateSupplier.execute({
      supplierId: id,
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
      ...(dto.paymentTerms !== undefined ? { paymentTerms: paymentTermsFromDto(dto.paymentTerms) } : {}),
      ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
      ...(dto.contactName !== undefined ? { contactName: dto.contactName } : {}),
      ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail } : {}),
      ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
      ...(dto.address !== undefined ? { address: dto.address } : {}),
      ...(dto.bankAccount !== undefined ? { bankAccount: dto.bankAccount } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });
    return { data: result };
  }

  // ─── Requisitions (PUR-12) ─────────────────────────────────────────────

  @Post('requisitions')
  @ApiCreatedResponse({ type: RequisitionEnvelopeResponse })
  @RequiresPermission('purchasing:requisition:write')
  @Audit({ action: 'CREATE', entityType: 'requisition', captureAfter: true })
  @UsePipes(new ZodValidationPipe(submitRequisitionSchema))
  async submitRequisitionRoute(@Body() dto: SubmitRequisitionDto): Promise<{ data: Record<string, unknown> }> {
    const result = await this.submitRequisition.execute({
      ...(dto.requiredByDate !== undefined ? { requiredByDate: dto.requiredByDate } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      lines: toRequisitionLines(dto.lines),
    });
    return { data: result };
  }

  @Post('requisitions/:id/approve')
  @ApiOkResponse({ type: RequisitionEnvelopeResponse })
  @RequiresPermission('purchasing:requisition:write')
  @Audit({ action: 'UPDATE', entityType: 'requisition', captureBefore: true, captureAfter: true })
  async approveRequisitionRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.approveRequisition.execute({ requisitionId: id });
    return { data: result };
  }

  // ─── Purchase orders (PUR-3, PUR-8) ────────────────────────────────────

  @Post('purchase-orders')
  @ApiCreatedResponse({ type: PurchaseOrderEnvelopeResponse })
  @RequiresPermission('purchasing:po:write')
  @Audit({ action: 'CREATE', entityType: 'purchase_order', captureAfter: true })
  @UsePipes(new ZodValidationPipe(createPurchaseOrderSchema))
  async createPurchaseOrderRoute(@Body() dto: CreatePurchaseOrderDto): Promise<{ data: Record<string, unknown> }> {
    const result = await this.createPurchaseOrder.execute({
      supplierId: dto.supplierId,
      currency: dto.currency,
      ...(dto.orderDate !== undefined ? { orderDate: dto.orderDate } : {}),
      ...(dto.expectedDate !== undefined ? { expectedDate: dto.expectedDate } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      lines: toPoLines(dto.lines),
    });
    return { data: result };
  }

  @Post('purchase-orders/:id/approve')
  @ApiOkResponse({ type: PurchaseOrderEnvelopeResponse })
  @RequiresPermission('purchasing:po:write')
  @Audit({ action: 'UPDATE', entityType: 'purchase_order', captureBefore: true, captureAfter: true })
  async approvePurchaseOrderRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.approvePurchaseOrder.execute({ purchaseOrderId: id });
    return { data: result };
  }

  @Get('purchase-orders')
  @ApiOkResponse({ type: PurchaseOrderListEnvelopeResponse })
  @RequiresPermission('purchasing:po:write')
  async listPurchaseOrdersRoute(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const result = await this.listPurchaseOrders.execute(filterFromQuery({ q, page, pageSize, status }));
    return { data: result as unknown as Record<string, unknown> };
  }

  @Get('purchase-orders/:id')
  @ApiOkResponse({ type: PurchaseOrderDetailEnvelopeResponse })
  @RequiresPermission('purchasing:po:write')
  async getPurchaseOrderRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.getPurchaseOrder.execute({ purchaseOrderId: id });
    return { data: result as unknown as Record<string, unknown> };
  }

  // ─── GRNs (PUR-4, PUR-5) ───────────────────────────────────────────────

  @Post('grns')
  @ApiCreatedResponse({ type: GrnEnvelopeResponse })
  @RequiresPermission('purchasing:grn:receive')
  @Audit({ action: 'CREATE', entityType: 'grn', captureAfter: true })
  @UsePipes(new ZodValidationPipe(receiveGrnSchema))
  async receiveGrnRoute(
    @Body() dto: ReceiveGrnDto,
    @Headers('Idempotency-Key') idempotencyKeyHeader?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const key = idempotencyKeyHeader ?? dto.idempotencyKey ?? undefined;
    if (key && !z.string().uuid().safeParse(key).success) {
      throw new BadRequestException('Idempotency-Key must be a UUID (PUR-13)');
    }
    const result = await this.receiveGrn.execute({
      poId: dto.poId,
      ...(dto.warehouseId !== undefined ? { warehouseId: dto.warehouseId } : {}),
      idempotencyKey: key ?? null,
      lines: toGrnLines(dto.lines),
    });
    return { data: result };
  }

  @Get('grns')
  @ApiOkResponse({ type: GrnListEnvelopeResponse })
  @RequiresPermission('purchasing:grn:receive')
  async listGrnsRoute(
    @Query('q') q?: string,
    @Query('supplierId') supplierId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const result = await this.listGrns.execute(filterFromQuery({ q, page, pageSize, supplierId }));
    return { data: result as unknown as Record<string, unknown> };
  }

  @Get('grns/:id')
  @ApiOkResponse({ type: GrnEnvelopeResponse })
  @RequiresPermission('purchasing:grn:receive')
  async getGrnRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.getGrn.execute({ grnId: id });
    return { data: result as unknown as Record<string, unknown> };
  }

  // ─── Bills (PUR-6, PUR-7) ──────────────────────────────────────────────

  @Post('bills')
  @ApiCreatedResponse({ type: BillEnvelopeResponse })
  @RequiresPermission('purchasing:bill:approve')
  @Audit({ action: 'CREATE', entityType: 'bill', captureAfter: true })
  @UsePipes(new ZodValidationPipe(createBillSchema))
  async createBillRoute(@Body() dto: CreateBillDto): Promise<{ data: Record<string, unknown> }> {
    const result = await this.createBill.execute({
      supplierId: dto.supplierId,
      ...(dto.poId !== undefined ? { poId: dto.poId } : {}),
      ...(dto.grnId !== undefined ? { grnId: dto.grnId } : {}),
      ...(dto.billDate !== undefined ? { billDate: dto.billDate } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate } : {}),
      currency: dto.currency,
      ...(dto.supplierTaxIdSnapshot !== undefined ? { supplierTaxIdSnapshot: dto.supplierTaxIdSnapshot } : {}),
      ...(dto.idempotencyKey !== undefined ? { idempotencyKey: dto.idempotencyKey } : {}),
      lines: toBillLines(dto.lines),
    });
    return { data: result };
  }

  @Post('bills/:id/approve')
  @ApiOkResponse({ type: BillEnvelopeResponse })
  @RequiresPermission('purchasing:bill:approve')
  @Audit({ action: 'UPDATE', entityType: 'bill', captureBefore: true, captureAfter: true })
  @UsePipes(new ZodValidationPipe(approveSchema))
  async approveBillRoute(
    @Param('id') id: string,
    @Body() dto: ApproveDto,
    @Headers('Idempotency-Key') idempotencyKeyHeader?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const key = idempotencyKeyHeader ?? dto.idempotencyKey ?? undefined;
    if (key && !z.string().uuid().safeParse(key).success) {
      throw new BadRequestException('Idempotency-Key must be a UUID (PUR-13)');
    }
    const result = await this.approveBill.execute({ billId: id, idempotencyKey: key ?? null });
    return { data: result };
  }

  @Get('bills')
  @ApiOkResponse({ type: BillListEnvelopeResponse })
  @RequiresPermission('purchasing:bill:approve')
  async listBillsRoute(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('supplierId') supplierId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const result = await this.listBills.execute(filterFromQuery({ q, page, pageSize, status, supplierId }));
    return { data: result as unknown as Record<string, unknown> };
  }

  @Get('bills/:id')
  @ApiOkResponse({ type: BillEnvelopeResponse })
  @RequiresPermission('purchasing:bill:approve')
  async getBillRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.getBill.execute({ billId: id });
    return { data: result as unknown as Record<string, unknown> };
  }

  // ─── Supplier payments (PUR-7) ─────────────────────────────────────────

  @Post('payments')
  @ApiCreatedResponse({ type: PaymentEnvelopeResponse })
  @RequiresPermission('purchasing:payment:record')
  @Audit({ action: 'CREATE', entityType: 'supplier_payment', captureAfter: true })
  @UsePipes(new ZodValidationPipe(recordPaymentSchema))
  async recordPaymentRoute(
    @Body() dto: RecordPaymentDto,
    @Headers('Idempotency-Key') idempotencyKeyHeader?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const key = idempotencyKeyHeader ?? dto.idempotencyKey ?? undefined;
    if (key && !z.string().uuid().safeParse(key).success) {
      throw new BadRequestException('Idempotency-Key must be a UUID (PUR-13)');
    }
    const result = await this.recordPayment.execute({
      supplierId: dto.supplierId,
      method: dto.method,
      amountMinor: dto.amountMinor,
      currency: dto.currency,
      ...(dto.paidAt !== undefined ? { paidAt: dto.paidAt } : {}),
      ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
      allocations: dto.allocations,
      idempotencyKey: key ?? null,
    });
    return { data: result };
  }

  @Get('payments')
  @ApiOkResponse({ type: PaymentListEnvelopeResponse })
  @RequiresPermission('purchasing:payment:record')
  async listPaymentsRoute(
    @Query('q') q?: string,
    @Query('method') method?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const result = await this.listPayments.execute(filterFromQuery({ q, page, pageSize, method }));
    return { data: result as unknown as Record<string, unknown> };
  }

  @Get('payments/:id')
  @ApiOkResponse({ type: PaymentDetailEnvelopeResponse })
  @RequiresPermission('purchasing:payment:record')
  async getPaymentRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.getPayment.execute({ paymentId: id });
    return { data: result as unknown as Record<string, unknown> };
  }

  // ─── Supplier returns (PUR-11) ─────────────────────────────────────────

  @Post('returns')
  @ApiCreatedResponse({ type: SupplierReturnEnvelopeResponse })
  @RequiresPermission('purchasing:return:create')
  @Audit({ action: 'CREATE', entityType: 'supplier_return', captureAfter: true })
  @UsePipes(new ZodValidationPipe(createSupplierReturnSchema))
  async createSupplierReturnRoute(@Body() dto: CreateSupplierReturnDto): Promise<{ data: Record<string, unknown> }> {
    const result = await this.createSupplierReturn.execute({
      supplierId: dto.supplierId,
      ...(dto.billId !== undefined ? { billId: dto.billId } : {}),
      ...(dto.grnLineId !== undefined ? { grnLineId: dto.grnLineId } : {}),
      reasonCode: dto.reasonCode,
      currency: dto.currency,
      lines: toReturnLines(dto.lines),
    });
    return { data: result };
  }

  @Post('returns/:id/approve')
  @ApiOkResponse({ type: SupplierReturnEnvelopeResponse })
  @RequiresPermission('purchasing:return:create')
  @Audit({ action: 'UPDATE', entityType: 'supplier_return', captureBefore: true, captureAfter: true })
  @UsePipes(new ZodValidationPipe(approveSchema))
  async approveSupplierReturnRoute(
    @Param('id') id: string,
    @Body() dto: ApproveDto,
    @Headers('Idempotency-Key') idempotencyKeyHeader?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const key = idempotencyKeyHeader ?? dto.idempotencyKey ?? undefined;
    if (key && !z.string().uuid().safeParse(key).success) {
      throw new BadRequestException('Idempotency-Key must be a UUID (PUR-13)');
    }
    const result = await this.approveSupplierReturn.execute({ supplierReturnId: id, idempotencyKey: key ?? null });
    return { data: result };
  }

  @Get('returns')
  @ApiOkResponse({ type: SupplierReturnListEnvelopeResponse })
  @RequiresPermission('purchasing:return:create')
  async listSupplierReturnsRoute(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const result = await this.listSupplierReturns.execute(filterFromQuery({ q, page, pageSize }));
    return { data: result as unknown as Record<string, unknown> };
  }

  @Get('returns/:id')
  @ApiOkResponse({ type: SupplierReturnDetailEnvelopeResponse })
  @RequiresPermission('purchasing:return:create')
  async getSupplierReturnRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.getSupplierReturn.execute({ returnId: id });
    return { data: result as unknown as Record<string, unknown> };
  }

  // ─── Vendor balances (PUR-2) ───────────────────────────────────────────

  @Get('vendor-balances')
  @ApiOkResponse({ type: VendorBalancesEnvelopeResponse })
  @RequiresPermission('purchasing:report:view')
  async vendorBalancesRoute(): Promise<{ data: Record<string, unknown> }> {
    const result = await this.getVendorBalances.execute();
    return { data: result as unknown as Record<string, unknown> };
  }
}

/**
 * Build a filter object from optional query params, dropping undefined keys
 * (exactOptionalPropertyTypes: a key explicitly set to undefined is an error).
 */
function filterFromQuery(input: {
  q?: string | undefined;
  page?: string | undefined;
  pageSize?: string | undefined;
  status?: string | undefined;
  method?: string | undefined;
  supplierId?: string | undefined;
}): Record<string, string | number> {
  const filter: Record<string, string | number> = {};
  if (input.q) filter.q = input.q;
  if (input.status) filter.status = input.status;
  if (input.method) filter.method = input.method;
  if (input.supplierId) filter.supplierId = input.supplierId;
  if (input.page) filter.page = Number(input.page);
  if (input.pageSize) filter.pageSize = Number(input.pageSize);
  return filter;
}

/**
 * Map a zod-inferred payment-terms object onto the domain's fully-typed
 * PaymentTerms (PUR-10). Missing members default to 0, mirroring
 * normalizePaymentTerms.
 */
function paymentTermsFromDto(terms: NonNullable<CreateSupplierDto['paymentTerms']>): PaymentTerms {
  return {
    netDays: terms.netDays ?? 0,
    discountDays: terms.discountDays ?? 0,
    discountRateBp: terms.discountRateBp ?? 0,
  };
}

/**
 * Map zod-inferred line objects onto the domain line-input shapes. Optional
 * DTO fields are rebuilt with conditional spreads so the result satisfies
 * exactOptionalPropertyTypes (no explicit `undefined` values).
 */
function toRequisitionLines(lines: SubmitRequisitionDto['lines']): RequisitionLineInput[] {
  return lines.map((l) => ({
    ...(l.variantId !== undefined ? { variantId: l.variantId } : {}),
    itemNameSnapshot: l.itemNameSnapshot,
    quantity: l.quantity ?? '1',
    ...(l.unitCostCurrency !== undefined ? { estimatedUnitCostCurrency: l.unitCostCurrency } : {}),
    estimatedUnitCostMinor: l.unitCostMinor,
  }));
}

function toPoLines(lines: CreatePurchaseOrderDto['lines']): PoLineInput[] {
  return lines.map((l) => ({
    ...(l.variantId !== undefined ? { variantId: l.variantId } : {}),
    itemNameSnapshot: l.itemNameSnapshot,
    ...(l.quantity !== undefined ? { quantity: l.quantity } : {}),
    unitCostMinor: l.unitCostMinor,
    ...(l.unitCostCurrency !== undefined ? { unitCostCurrency: l.unitCostCurrency } : {}),
    ...(l.discountMinor !== undefined ? { discountMinor: l.discountMinor } : {}),
    ...(l.taxRateBpSnapshot !== undefined ? { taxRateBpSnapshot: l.taxRateBpSnapshot } : {}),
  }));
}

function toGrnLines(lines: ReceiveGrnDto['lines']): GrnLineInput[] {
  return lines.map((l) => ({
    poLineId: l.poLineId,
    ...(l.variantId !== undefined ? { variantId: l.variantId } : {}),
    quantity: l.quantity,
    unitCostMinor: l.unitCostMinor,
    ...(l.unitCostCurrency !== undefined ? { unitCostCurrency: l.unitCostCurrency } : {}),
    ...(l.accepted !== undefined ? { accepted: l.accepted } : {}),
  }));
}

function toBillLines(lines: CreateBillDto['lines']): BillLineInput[] {
  return lines.map((l) => ({
    ...(l.poLineId !== undefined ? { poLineId: l.poLineId } : {}),
    ...(l.grnLineId !== undefined ? { grnLineId: l.grnLineId } : {}),
    ...(l.variantId !== undefined ? { variantId: l.variantId } : {}),
    ...(l.itemNameSnapshot !== undefined ? { itemNameSnapshot: l.itemNameSnapshot } : {}),
    quantity: l.quantity,
    unitCostMinor: l.unitCostMinor,
    ...(l.unitCostCurrency !== undefined ? { unitCostCurrency: l.unitCostCurrency } : {}),
    ...(l.taxRateBpSnapshot !== undefined ? { taxRateBpSnapshot: l.taxRateBpSnapshot } : {}),
  }));
}

function toReturnLines(lines: CreateSupplierReturnDto['lines']): SupplierReturnLineInput[] {
  return lines.map((l) => ({
    ...(l.variantId !== undefined ? { variantId: l.variantId } : {}),
    quantity: l.quantity,
    unitCostMinor: l.unitCostMinor,
    ...(l.unitCostCurrency !== undefined ? { unitCostCurrency: l.unitCostCurrency } : {}),
  }));
}
