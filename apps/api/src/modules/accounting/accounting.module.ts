import { Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { TAX_RATE_READ_PORT } from '@modubiz/contracts';

import { EntitlementsModule } from '../../core/entitlements/__init__.js';
import { PortRegistry } from '../../core/ports/port-registry.js';

import { AccountingController } from './api/index.js';
import {
  ApplyPaymentUseCase,
  CreateAccountUseCase,
  CreateTaxRateUseCase,
  EnsureDefaultChartOfAccountsUseCase,
  GenerateInvoiceFromPosSaleUseCase,
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
} from './application/index.js';
import { ACCOUNTING_REPOSITORY } from './application/ports/index.js';
import { DrizzleAccountingRepository, TaxRateReadPortImpl } from './infrastructure/index.js';
import {
  InventoryMovementRecordedHandler,
  PosSaleCompletedHandler,
  PurchasingBillApprovedHandler,
  PurchasingPaymentRecordedHandler,
  PurchasingSupplierReturnApprovedHandler,
} from './events/handlers/index.js';
import { EInvoiceStatusJob, GlReconciliationJob, OverdueInvoiceJob } from './jobs/index.js';

/**
 * AccountingModule — Nest composition of the accounting bounded context.
 *
 * The repository is bound to the ACCOUNTING_REPOSITORY port token; use cases
 * depend only on the port (MODULE_GUIDE.md §3). GL event handlers consume
 * `pos.sale.completed.v1` (ACC-13) and `inventory.stock.movement_recorded.v1`
 * (ACC-15) idempotently. The Phase 8 purchasing handlers are declared in
 * @modubiz/contracts and wired here in Phase 8, when purchasing registers.
 */
@Module({
  // EntitlementsModule provides EntitlementService (not @Global) — the GL
  // event handlers gate posting on the accounting entitlement (ACC-16).
  imports: [EntitlementsModule],
  controllers: [AccountingController],
  providers: [
    // Repository (infrastructure) bound to the port token.
    { provide: ACCOUNTING_REPOSITORY, useClass: DrizzleAccountingRepository },
    // Level 2 read port: the centralized tax-rate catalog consumers resolve
    // through PortRegistry (TAX_RATE_READ_PORT).
    TaxRateReadPortImpl,
    // Use cases (application).
    GetStatusUseCase,
    EnsureDefaultChartOfAccountsUseCase,
    CreateAccountUseCase,
    GetAccountDetailUseCase,
    UpdateAccountUseCase,
    CreateTaxRateUseCase,
    ListTaxRatesUseCase,
    UpdateTaxRateUseCase,
    GetInvoiceDetailUseCase,
    GetJournalEntryDetailUseCase,
    GetPaymentDetailUseCase,
    PostJournalEntryUseCase,
    ReverseJournalEntryUseCase,
    IssueInvoiceUseCase,
    ApplyPaymentUseCase,
    IssueCreditNoteUseCase,
    GenerateInvoiceFromPosSaleUseCase,
    ListJournalEntriesUseCase,
    ListInvoicesUseCase,
    ListPaymentsUseCase,
    ListCreditNotesUseCase,
    GetCreditNoteDetailUseCase,
    // Reports (read-only, ACC-1/ACC-8/ACC-9).
    GetTrialBalanceUseCase,
    GetIncomeStatementUseCase,
    GetBalanceSheetUseCase,
    GetArAgingUseCase,
    // GL event handlers (ACC-13, ACC-15) — registered via @HandleEvent.
    PosSaleCompletedHandler,
    InventoryMovementRecordedHandler,
    // Phase 8 AP handlers (ACC-15) — post Dr Inventory/Expense/Input-VAT ·
    // Cr AP, Dr AP · Cr Bank/Cash, and Dr AP · Cr Inventory/Input-VAT
    // idempotently.
    PurchasingBillApprovedHandler,
    PurchasingPaymentRecordedHandler,
    PurchasingSupplierReturnApprovedHandler,
    // Job processors (invoked by the platform scheduler; payloads carry orgId).
    OverdueInvoiceJob,
    GlReconciliationJob,
    EInvoiceStatusJob,
  ],
})
export class AccountingModule implements OnModuleInit {
  constructor(
    private readonly portRegistry: PortRegistry,
    private readonly taxRateReadPort: TaxRateReadPortImpl,
  ) {}

  onModuleInit(): void {
    // ACC-11: expose the tax-rate catalog read port for POS + purchasing.
    this.portRegistry.register(TAX_RATE_READ_PORT, this.taxRateReadPort);
  }
}
