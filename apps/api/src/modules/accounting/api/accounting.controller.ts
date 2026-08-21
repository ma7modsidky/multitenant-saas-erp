import { MODULE_KEYS } from '@modubiz/contracts';
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
import {
  ApplyPaymentUseCase,
  CreateAccountUseCase,
  CreateTaxRateUseCase,
  EnsureDefaultChartOfAccountsUseCase,
  GetAccountDetailUseCase,
  GetArAgingUseCase,
  GetBalanceSheetUseCase,
  GetCreditNoteDetailUseCase,
  GetIncomeStatementUseCase,
  GetInvoiceDetailUseCase,
  GetJournalEntryDetailUseCase,
  GetPaymentDetailUseCase,
  GetStatusUseCase,
  GetTrialBalanceUseCase,
  IssueCreditNoteUseCase,
  IssueInvoiceUseCase,
  ListCreditNotesUseCase,
  ListInvoicesUseCase,
  ListJournalEntriesUseCase,
  ListPaymentsUseCase,
  ListTaxRatesUseCase,
  PostJournalEntryUseCase,
  ReverseJournalEntryUseCase,
  UpdateAccountUseCase,
  UpdateTaxRateUseCase,
} from '../application/index.js';

import type {
  ApplyPaymentDto,
  CreateAccountDto,
  CreateTaxRateDto,
  IssueCreditNoteDto,
  IssueInvoiceDto,
  PostJournalEntryDto,
  UpdateAccountDto,
  UpdateTaxRateDto,
} from './dto/index.js';
import {
  AccountDetailEnvelopeResponse,
  AccountListEnvelopeResponse,
  AccountUpdateEnvelopeResponse,
  ArAgingEnvelopeResponse,
  BalanceSheetEnvelopeResponse,
  CreditNoteDetailEnvelopeResponse,
  CreditNoteEnvelopeResponse,
  CreditNoteListEnvelopeResponse,
  IncomeStatementEnvelopeResponse,
  InvoiceDetailEnvelopeResponse,
  InvoiceEnvelopeResponse,
  InvoiceListEnvelopeResponse,
  JournalEntryDetailEnvelopeResponse,
  JournalEntryEnvelopeResponse,
  JournalListEnvelopeResponse,
  PaymentDetailEnvelopeResponse,
  PaymentEnvelopeResponse,
  PaymentListEnvelopeResponse,
  TaxRateEnvelopeResponse,
  TaxRateListEnvelopeResponse,
  TaxRateUpdateEnvelopeResponse,
  TrialBalanceEnvelopeResponse,
  applyPaymentSchema,
  createAccountSchema,
  createTaxRateSchema,
  issueCreditNoteSchema,
  issueInvoiceSchema,
  postJournalEntrySchema,
  updateAccountSchema,
  updateTaxRateSchema,
} from './dto/index.js';

/**
 * AccountingController — Accounting & Invoicing endpoints (`/v1/accounting/...`).
 *
 * All routes require JWT auth + the `accounting` module entitlement (AUTHZ-6) +
 * the matching permission. Controllers validate, delegate to a use case, and
 * map the response — no business logic (hard rule #6). Money crosses the API
 * as `{ amountMinor, currency }` strings (CUR-9).
 *
 * @see ACC-1 (balanced entries), ACC-3 (gap-free numbers), ACC-6 (AR entry
 *      atomic with issuance), ACC-8 (status lifecycle), ACC-9 (partial
 *      payments), ACC-10 (credit notes), ACC-14 (goods stock deduction)
 */
@Controller('v1/accounting')
@UseGuards(AuthGuard('jwt'))
@RequiresModule(MODULE_KEYS.ACCOUNTING)
export class AccountingController {
  constructor(
    private readonly getStatus: GetStatusUseCase,
    private readonly ensureCoa: EnsureDefaultChartOfAccountsUseCase,
    private readonly createAccount: CreateAccountUseCase,
    private readonly getAccountDetail: GetAccountDetailUseCase,
    private readonly updateAccount: UpdateAccountUseCase,
    private readonly createTaxRate: CreateTaxRateUseCase,
    private readonly listTaxRates: ListTaxRatesUseCase,
    private readonly updateTaxRate: UpdateTaxRateUseCase,
    private readonly getInvoiceDetail: GetInvoiceDetailUseCase,
    private readonly getJournalEntryDetail: GetJournalEntryDetailUseCase,
    private readonly getPaymentDetail: GetPaymentDetailUseCase,
    private readonly getCreditNoteDetail: GetCreditNoteDetailUseCase,
    private readonly listCreditNotes: ListCreditNotesUseCase,
    private readonly postJournalEntry: PostJournalEntryUseCase,
    private readonly reverseJournalEntry: ReverseJournalEntryUseCase,
    private readonly listJournalEntries: ListJournalEntriesUseCase,
    private readonly issueInvoice: IssueInvoiceUseCase,
    private readonly applyPayment: ApplyPaymentUseCase,
    private readonly issueCreditNote: IssueCreditNoteUseCase,
    private readonly listInvoices: ListInvoicesUseCase,
    private readonly listPayments: ListPaymentsUseCase,
    private readonly trialBalance: GetTrialBalanceUseCase,
    private readonly incomeStatement: GetIncomeStatementUseCase,
    private readonly balanceSheet: GetBalanceSheetUseCase,
    private readonly arAging: GetArAgingUseCase,
  ) {}

  /** Public status probe. */
  @PublicRoute()
  @Get('status')
  async status(): Promise<{ data: { module: string; status: string } }> {
    return { data: await this.getStatus.execute() };
  }

  // ─── Chart of accounts (ACC-5) ─────────────────────────────────────────

  @Get('coa')
  @ApiOkResponse({ type: AccountListEnvelopeResponse })
  @RequiresPermission('accounting:coa:manage')
  async listCoaRoute(): Promise<{ data: { items: Record<string, unknown>[] } }> {
    // ACC-5: the first read seeds the default SME chart lazily + idempotently.
    const accounts = await this.ensureCoa.ensureAndList();
    return {
      data: {
        items: accounts.map((account) => ({
          id: account.id,
          code: account.code,
          nameI18n: account.nameI18n,
          type: account.type,
          isSystem: account.isSystem,
          isActive: account.isActive,
        })),
      },
    };
  }

  // ─── Custom accounts (ACC-5/ACC-16) ────────────────────────────────────

  @Post('coa')
  @ApiCreatedResponse({ type: AccountListEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(createAccountSchema))
  @RequiresPermission('accounting:coa:manage')
  @Audit({ action: 'CREATE', entityType: 'account', captureAfter: true })
  async createAccountRoute(@Body() dto: CreateAccountDto): Promise<{ data: Record<string, unknown> }> {
    // ACC-16: the use case rejects this with ACCOUNTING_COA_READ_ONLY when the
    // advanced_coa feature is not entitled (fail closed).
    const result = await this.createAccount.execute({
      code: dto.code,
      name: dto.name,
      type: dto.type,
      ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
    });
    return { data: { accountId: result.accountId, code: result.code } };
  }

  /**
   * Account detail — header + current balance + paginated GL history. The
   * movements accept an optional date range and page; the running balance is
   * computed over the whole filtered set, so a page is always cumulative.
   */
  @Get('coa/:id')
  @ApiOkResponse({ type: AccountDetailEnvelopeResponse })
  @RequiresPermission('accounting:coa:manage')
  async getAccountDetailRoute(
    @Param('id') id: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    if (fromDate !== undefined && !ISO_DATE_RE.test(fromDate)) {
      throw new BadRequestException('fromDate must be an ISO date (YYYY-MM-DD)');
    }
    if (toDate !== undefined && !ISO_DATE_RE.test(toDate)) {
      throw new BadRequestException('toDate must be an ISO date (YYYY-MM-DD)');
    }
    const result = await this.getAccountDetail.execute({
      accountId: id,
      ...(fromDate !== undefined ? { fromDate } : {}),
      ...(toDate !== undefined ? { toDate } : {}),
      ...(page !== undefined ? { page: parsePage(page) } : {}),
      ...(pageSize !== undefined ? { pageSize: parsePage(pageSize) } : {}),
    });
    return { data: result };
  }

  /** Rename and/or toggle active on an account — the code never changes (ACC-5). */
  @Patch('coa/:id')
  @ApiOkResponse({ type: AccountUpdateEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(updateAccountSchema))
  @RequiresPermission('accounting:coa:manage')
  @Audit({ action: 'UPDATE', entityType: 'account', captureBefore: true, captureAfter: true })
  async updateAccountRoute(
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<{ data: Record<string, unknown> }> {
    // ACC-16: gated on advanced_coa like creation (fail closed).
    const result = await this.updateAccount.execute({
      accountId: id,
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });
    return { data: { accountId: result.accountId } };
  }

  // ─── Tax rates (ACC-11) ────────────────────────────────────────────────

  /** Tax-rate catalog — the resolution source for the tax engine (POS/invoicing). */
  @Get('tax-rates')
  @ApiOkResponse({ type: TaxRateListEnvelopeResponse })
  @RequiresPermission('accounting:tax:manage')
  async listTaxRatesRoute(): Promise<{ data: { items: Record<string, unknown>[] } }> {
    const rates = await this.listTaxRates.execute();
    return { data: { items: rates as unknown as Record<string, unknown>[] } };
  }

  @Post('tax-rates')
  @ApiCreatedResponse({ type: TaxRateEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(createTaxRateSchema))
  @RequiresPermission('accounting:tax:manage')
  @Audit({ action: 'CREATE', entityType: 'tax_rate', captureAfter: true })
  async createTaxRateRoute(@Body() dto: CreateTaxRateDto): Promise<{ data: { taxRateId: string; code: string } }> {
    const result = await this.createTaxRate.execute({
      code: dto.code,
      nameI18n: dto.nameI18n ?? {},
      rateBp: dto.rateBp,
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.taxBasis !== undefined ? { taxBasis: dto.taxBasis } : {}),
      ...(dto.coaAccountId !== undefined && dto.coaAccountId !== null ? { coaAccountId: dto.coaAccountId } : {}),
      ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
      ...(dto.effectiveFrom !== undefined ? { effectiveFrom: dto.effectiveFrom } : {}),
    });
    return { data: result };
  }

  @Patch('tax-rates/:id')
  @ApiOkResponse({ type: TaxRateUpdateEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(updateTaxRateSchema))
  @RequiresPermission('accounting:tax:manage')
  @Audit({ action: 'UPDATE', entityType: 'tax_rate', captureBefore: true, captureAfter: true })
  async updateTaxRateRoute(
    @Param('id') id: string,
    @Body() dto: UpdateTaxRateDto,
  ): Promise<{ data: { taxRateId: string } }> {
    const result = await this.updateTaxRate.execute({
      taxRateId: id,
      ...(dto.nameI18n !== undefined ? { nameI18n: dto.nameI18n } : {}),
      ...(dto.rateBp !== undefined ? { rateBp: dto.rateBp } : {}),
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.taxBasis !== undefined ? { taxBasis: dto.taxBasis } : {}),
      ...(dto.coaAccountId !== undefined ? { coaAccountId: dto.coaAccountId } : {}),
      ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    });
    return { data: result };
  }

  // ─── Journal (ACC-1/3/4, ACC-2 reversals) ───────────────────────────────
  @Post('journal')
  @ApiCreatedResponse({ type: JournalEntryEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(postJournalEntrySchema))
  @RequiresPermission('accounting:journal:post')
  @Audit({ action: 'CREATE', entityType: 'journal_entry', captureAfter: true })
  async postJournalEntryRoute(@Body() dto: PostJournalEntryDto): Promise<{ data: Record<string, unknown> }> {
    const result = await this.postJournalEntry.execute({
      entryDate: dto.entryDate,
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      currency: dto.currency,
      sourceType: 'manual',
      lines: dto.lines.map((line) => ({
        accountId: line.accountId,
        ...(line.debit !== undefined
          ? { debitAmountMinor: line.debit.amountMinor }
          : { creditAmountMinor: line.credit!.amountMinor }),
        memo: line.memo ?? null,
      })),
    });
    return { data: { entryId: result.entryId, entryNumber: result.entryNumber } };
  }

  @Post('journal/:id/reverse')
  @ApiCreatedResponse({ type: JournalEntryEnvelopeResponse })
  @RequiresPermission('accounting:journal:post')
  @Audit({ action: 'UPDATE', entityType: 'journal_entry', captureBefore: true })
  async reverseJournalEntryRoute(
    @Param('id') id: string,
    @Body() dto: { description?: string },
  ): Promise<{ data: Record<string, unknown> }> {
    const result = await this.reverseJournalEntry.execute({
      entryId: id,
      ...(dto.description !== undefined ? { description: dto.description } : {}),
    });
    return {
      data: { entryId: result.entryId, reversalEntryId: result.reversalEntryId },
    };
  }

  @Get('journal')
  @ApiOkResponse({ type: JournalListEnvelopeResponse })
  @RequiresPermission('accounting:report:view')
  async listJournalRoute(
    @Query('q') q?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('sourceType') sourceType?: string,
    @Query('sourceId') sourceId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    if (fromDate !== undefined && !ISO_DATE_RE.test(fromDate)) {
      throw new BadRequestException('fromDate must be an ISO date (YYYY-MM-DD)');
    }
    if (toDate !== undefined && !ISO_DATE_RE.test(toDate)) {
      throw new BadRequestException('toDate must be an ISO date (YYYY-MM-DD)');
    }
    const result = await this.listJournalEntries.execute({
      ...(q !== undefined && q.trim() !== '' ? { q } : {}),
      ...(fromDate !== undefined ? { fromDate } : {}),
      ...(toDate !== undefined ? { toDate } : {}),
      ...(sourceType !== undefined && sourceType.trim() !== '' ? { sourceType } : {}),
      ...(sourceId !== undefined && sourceId.trim() !== '' ? { sourceId } : {}),
      ...(page !== undefined ? { page: parsePage(page) } : {}),
      ...(pageSize !== undefined ? { pageSize: parsePage(pageSize) } : {}),
    });
    return {
      data: {
        items: result.items.map((entry) => ({
          id: entry.id,
          entryNumber: entry.entryNumber,
          entryDate: entry.entryDate,
          description: entry.description,
          currency: entry.currency,
          status: entry.status,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          postedAt: entry.postedAt,
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  }

  /** Journal entry detail — resolved lines, actor metadata, source reference. */
  @Get('journal/:id')
  @ApiOkResponse({ type: JournalEntryDetailEnvelopeResponse })
  @RequiresPermission('accounting:report:view')
  async getJournalEntryDetailRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.getJournalEntryDetail.execute({ entryId: id });
    return { data: result };
  }

  // ─── Invoices (ACC-6/7/8/9/14) ─────────────────────────────────────────

  @Post('invoices')
  @ApiCreatedResponse({ type: InvoiceEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(issueInvoiceSchema))
  @RequiresPermission('accounting:invoice:write')
  @Audit({ action: 'CREATE', entityType: 'invoice', captureAfter: true })
  async issueInvoiceRoute(
    @Body() dto: IssueInvoiceDto,
    @Headers('Idempotency-Key') idempotencyKeyHeader?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const idempotencyKey = dto.idempotencyKey ?? idempotencyKeyHeader;
    if (idempotencyKey !== undefined && !isUuid(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key must be a UUID (ACC-13)');
    }
    const result = await this.issueInvoice.execute({
      ...(dto.customerContactId !== undefined ? { customerContactId: dto.customerContactId } : {}),
      ...(dto.customerCompanyId !== undefined ? { customerCompanyId: dto.customerCompanyId } : {}),
      customerNameSnapshot: dto.customerName,
      ...(dto.customerTaxId !== undefined ? { customerTaxIdSnapshot: dto.customerTaxId } : {}),
      ...(dto.sellerTaxId !== undefined ? { sellerTaxId: dto.sellerTaxId } : {}),
      ...(dto.invoiceDate !== undefined ? { invoiceDate: dto.invoiceDate } : {}),
      dueDate: dto.dueDate,
      currency: dto.currency,
      ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
      ...(dto.sourceType !== undefined ? { sourceType: dto.sourceType } : {}),
      ...(dto.sourceId !== undefined ? { sourceId: dto.sourceId } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      lines: dto.lines.map((line) => ({
        ...(line.variantId !== undefined ? { variantId: line.variantId } : {}),
        itemNameSnapshot: line.itemName,
        ...(line.description !== undefined ? { description: line.description } : {}),
        ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
        unitPriceAmountMinor: line.unitPrice.amountMinor,
        discountAmountMinor: line.discount?.amountMinor ?? '0',
        ...(line.taxRateId !== undefined && line.taxRateId !== null ? { taxRateId: line.taxRateId } : {}),
        ...(line.taxRateBp !== undefined ? { taxRateBpSnapshot: line.taxRateBp } : {}),
        ...(line.taxType !== undefined ? { taxTypeSnapshot: line.taxType } : {}),
        ...(line.isGoods !== undefined ? { isGoods: line.isGoods } : {}),
      })),
    });
    return { data: { invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber } };
  }

  /** Invoice detail — header, itemized lines, payment history, credit notes. */
  @Get('invoices/:id')
  @ApiOkResponse({ type: InvoiceDetailEnvelopeResponse })
  @RequiresPermission('accounting:invoice:read')
  async getInvoiceDetailRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.getInvoiceDetail.execute({ invoiceId: id });
    return { data: result };
  }

  @Get('invoices')
  @ApiOkResponse({ type: InvoiceListEnvelopeResponse })
  @RequiresPermission('accounting:invoice:read')
  async listInvoicesRoute(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    if (status !== undefined && !INVOICE_STATUS_VALUES.includes(status)) {
      throw new BadRequestException(`status must be one of: ${INVOICE_STATUS_VALUES.join(', ')}`);
    }
    if (fromDate !== undefined && !ISO_DATE_RE.test(fromDate)) {
      throw new BadRequestException('fromDate must be an ISO date (YYYY-MM-DD)');
    }
    if (toDate !== undefined && !ISO_DATE_RE.test(toDate)) {
      throw new BadRequestException('toDate must be an ISO date (YYYY-MM-DD)');
    }
    const result = await this.listInvoices.execute({
      ...(q !== undefined && q.trim() !== '' ? { q } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(fromDate !== undefined ? { fromDate } : {}),
      ...(toDate !== undefined ? { toDate } : {}),
      ...(page !== undefined ? { page: parsePage(page) } : {}),
      ...(pageSize !== undefined ? { pageSize: parsePage(pageSize) } : {}),
    });
    return {
      data: {
        items: result.items.map((invoice) => ({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerNameSnapshot: invoice.customerNameSnapshot,
          status: invoice.status,
          invoiceDate: invoice.invoiceDate,
          dueDate: invoice.dueDate,
          currency: invoice.currency,
          subtotalAmountMinor: invoice.subtotalAmountMinor,
          discountAmountMinor: invoice.discountAmountMinor,
          taxAmountMinor: invoice.taxAmountMinor,
          totalAmountMinor: invoice.totalAmountMinor,
          paidAmountMinor: invoice.paidAmountMinor,
          creditedAmountMinor: invoice.creditedAmountMinor,
          sourceType: invoice.sourceType,
          sourceId: invoice.sourceId,
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  }

  // ─── Payments (ACC-9) ──────────────────────────────────────────────────

  /** Payments list — every receipt with its invoice, newest first. */
  @Get('payments')
  @ApiOkResponse({ type: PaymentListEnvelopeResponse })
  @RequiresPermission('accounting:payment:apply')
  async listPaymentsRoute(
    @Query('q') q?: string,
    @Query('method') method?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    if (method !== undefined && !PAYMENT_METHOD_VALUES.includes(method)) {
      throw new BadRequestException(`method must be one of: ${PAYMENT_METHOD_VALUES.join(', ')}`);
    }
    this.assertIsoDates({ fromDate, toDate });
    const result = await this.listPayments.execute({
      ...(q !== undefined && q.trim() !== '' ? { q } : {}),
      ...(method !== undefined ? { method } : {}),
      ...(fromDate !== undefined ? { fromDate } : {}),
      ...(toDate !== undefined ? { toDate } : {}),
      ...(page !== undefined ? { page: parsePage(page) } : {}),
      ...(pageSize !== undefined ? { pageSize: parsePage(pageSize) } : {}),
    });
    return {
      data: {
        items: result.items.map((payment) => ({
          id: payment.id,
          method: payment.method,
          receiptNumber: payment.receiptNumber,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          receivedAt: payment.receivedAt,
          reference: payment.reference,
          invoiceId: payment.invoiceId,
          invoiceNumber: payment.invoiceNumber,
          customerNameSnapshot: payment.customerNameSnapshot,
          allocationAmountMinor: payment.allocationAmountMinor,
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  }

  /** Payment receipt detail — header + allocation breakdown (ACC-9). */
  @Get('payments/:id')
  @ApiOkResponse({ type: PaymentDetailEnvelopeResponse })
  @RequiresPermission('accounting:payment:apply')
  async getPaymentDetailRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.getPaymentDetail.execute({ paymentId: id });
    return { data: result };
  }

  @Post('payments')
  @ApiCreatedResponse({ type: PaymentEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(applyPaymentSchema))
  @RequiresPermission('accounting:payment:apply')
  @Audit({ action: 'CREATE', entityType: 'payment', captureAfter: true })
  async applyPaymentRoute(
    @Body() dto: ApplyPaymentDto,
    @Headers('Idempotency-Key') idempotencyKeyHeader?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const idempotencyKey = dto.idempotencyKey ?? idempotencyKeyHeader;
    if (idempotencyKey !== undefined && !isUuid(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key must be a UUID (ACC-9)');
    }
    const result = await this.applyPayment.execute({
      invoiceId: dto.invoiceId,
      method: dto.method,
      amountMinor: dto.amount.amountMinor,
      currency: dto.amount.currency,
      ...(dto.reference !== undefined ? { reference: dto.reference } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
    return { data: result };
  }

  // ─── Credit notes (ACC-10) ─────────────────────────────────────────────

  @Post('credit-notes')
  @ApiCreatedResponse({ type: CreditNoteEnvelopeResponse })
  @UsePipes(new ZodValidationPipe(issueCreditNoteSchema))
  @RequiresPermission('accounting:credit-note:issue')
  @Audit({ action: 'CREATE', entityType: 'credit_note', captureAfter: true })
  async issueCreditNoteRoute(@Body() dto: IssueCreditNoteDto): Promise<{ data: Record<string, unknown> }> {
    const result = await this.issueCreditNote.execute({
      invoiceId: dto.invoiceId,
      reasonCode: dto.reasonCode,
      lines: dto.lines.map((line) => ({
        invoiceLineId: line.invoiceLineId,
        ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
        unitPriceAmountMinor: line.unitPrice.amountMinor,
        ...(line.taxAmount !== undefined ? { taxAmountMinor: line.taxAmount.amountMinor } : {}),
      })),
    });
    return { data: result };
  }

  /** Credit-notes list — the reversal trail with its invoice + customer (ACC-10). */
  @Get('credit-notes')
  @ApiOkResponse({ type: CreditNoteListEnvelopeResponse })
  @RequiresPermission('accounting:report:view')
  async listCreditNotesRoute(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const result = await this.listCreditNotes.execute({
      ...(q !== undefined && q.trim() !== '' ? { q } : {}),
      ...(page !== undefined ? { page: parsePage(page) } : {}),
      ...(pageSize !== undefined ? { pageSize: parsePage(pageSize) } : {}),
    });
    return {
      data: {
        items: result.items.map((note) => ({
          id: note.id,
          creditNoteNumber: note.creditNoteNumber,
          invoiceId: note.invoiceId,
          invoiceNumber: note.invoiceNumber,
          customerNameSnapshot: note.customerNameSnapshot,
          status: note.status,
          reasonCode: note.reasonCode,
          amountMinor: note.amountMinor,
          currency: note.currency,
          issuedAt: note.issuedAt,
          createdAt: note.createdAt,
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      },
    };
  }

  /** Credit-note detail — header, reversed lines, and the reversal GL entry (ACC-10). */
  @Get('credit-notes/:id')
  @ApiOkResponse({ type: CreditNoteDetailEnvelopeResponse })
  @RequiresPermission('accounting:report:view')
  async getCreditNoteDetailRoute(@Param('id') id: string): Promise<{ data: Record<string, unknown> }> {
    const result = await this.getCreditNoteDetail.execute({ creditNoteId: id });
    return { data: result };
  }

  // ─── Reports (read-only, ACC-1/ACC-8/ACC-9) ────────────────────────────

  /** Trial balance — every account's debit/credit totals over a period. */
  @Get('reports/trial-balance')
  @ApiOkResponse({ type: TrialBalanceEnvelopeResponse })
  @RequiresPermission('accounting:report:view')
  async trialBalanceRoute(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    this.assertIsoDates({ fromDate, toDate });
    return {
      data: await this.trialBalance.execute({ ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) }),
    };
  }

  /** Income statement — revenue, expenses, and net income for a period. */
  @Get('reports/income-statement')
  @ApiOkResponse({ type: IncomeStatementEnvelopeResponse })
  @RequiresPermission('accounting:report:view')
  async incomeStatementRoute(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ): Promise<{ data: Record<string, unknown> }> {
    this.assertIsoDates({ fromDate, toDate });
    return {
      data: await this.incomeStatement.execute({ ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) }),
    };
  }

  /** Balance sheet — assets, liabilities, and equity as of a date. */
  @Get('reports/balance-sheet')
  @ApiOkResponse({ type: BalanceSheetEnvelopeResponse })
  @RequiresPermission('accounting:report:view')
  async balanceSheetRoute(@Query('asOfDate') asOfDate?: string): Promise<{ data: Record<string, unknown> }> {
    if (asOfDate !== undefined && !ISO_DATE_RE.test(asOfDate)) {
      throw new BadRequestException('asOfDate must be an ISO date (YYYY-MM-DD)');
    }
    return { data: await this.balanceSheet.execute({ ...(asOfDate ? { asOfDate } : {}) }) };
  }

  /** AR aging — open invoices bucketed by days past due as of a date. */
  @Get('reports/ar-aging')
  @ApiOkResponse({ type: ArAgingEnvelopeResponse })
  @RequiresPermission('accounting:report:view')
  async arAgingRoute(@Query('asOfDate') asOfDate?: string): Promise<{ data: Record<string, unknown> }> {
    if (asOfDate !== undefined && !ISO_DATE_RE.test(asOfDate)) {
      throw new BadRequestException('asOfDate must be an ISO date (YYYY-MM-DD)');
    }
    return { data: await this.arAging.execute({ ...(asOfDate ? { asOfDate } : {}) }) };
  }

  /** Shared ISO-date validation for the period-filtered report routes. */
  private assertIsoDates(dates: { fromDate?: string | undefined; toDate?: string | undefined }): void {
    if (dates.fromDate !== undefined && !ISO_DATE_RE.test(dates.fromDate)) {
      throw new BadRequestException('fromDate must be an ISO date (YYYY-MM-DD)');
    }
    if (dates.toDate !== undefined && !ISO_DATE_RE.test(dates.toDate)) {
      throw new BadRequestException('toDate must be an ISO date (YYYY-MM-DD)');
    }
  }
}

/** `page`/`pageSize` query → positive integer; NaN/0/negative is a 400. */
function parsePage(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException('page and pageSize must be positive integers');
  return n;
}

/** Strict ISO date (YYYY-MM-DD) for date-range filters. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The immutable invoice status vocabulary (ACC-8) — allow-lists the filter. */
const INVOICE_STATUS_VALUES = ['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void'];

/** The payment method vocabulary (ACC-9) — allow-lists the filter. */
const PAYMENT_METHOD_VALUES = ['cash', 'bank_transfer', 'card', 'cheque', 'other'];

/** UUID check for header idempotency keys (matches the body schema). */
function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}
