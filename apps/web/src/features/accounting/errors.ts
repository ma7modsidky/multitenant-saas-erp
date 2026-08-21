/**
 * Accounting error mapping — the backend returns machine codes
 * (CODING_STANDARDS §7, BUSINESS_RULES §13); the UI renders i18n keys.
 * Unknown codes fall back to a generic message.
 *
 * Returns keys RELATIVE to the `modules.accounting` namespace — every view
 * renders them with `useTranslations('modules.accounting')`.
 */
export function accountingErrorKey(code: string): string {
  switch (code) {
    case 'ACCOUNTING_ENTRY_UNBALANCED':
      return 'errors.unbalancedEntry';
    case 'ACCOUNTING_ENTRY_IMMUTABLE':
      return 'errors.postedEntryImmutable';
    case 'ACCOUNTING_INVOICE_NOT_DRAFT':
    case 'ACCOUNTING_INVOICE_IMMUTABLE':
      return 'errors.invoiceImmutable';
    case 'ACCOUNTING_INVOICE_CUSTOMER_REQUIRED':
      return 'errors.invoiceCustomerRequired';
    case 'ACCOUNTING_INVOICE_ILLEGAL_TRANSITION':
      return 'errors.illegalStatusTransition';
    case 'ACCOUNTING_PAYMENT_OVER_ALLOCATED':
      return 'errors.paymentExceedsInvoice';
    case 'ACCOUNTING_CREDIT_NOTE_EXCEEDS_INVOICE':
      return 'errors.creditNoteExceedsInvoice';
    case 'ACCOUNTING_STOCK_ISSUE_FAILED':
    case 'ACCOUNTING_GOODS_REQUIRES_INVENTORY':
      return 'errors.stockDeductionFailed';
    case 'ACCOUNTING_COA_INCOMPLETE':
      return 'errors.coaIncomplete';
    case 'ACCOUNTING_COA_READ_ONLY':
      return 'errors.coaReadOnly';
    case 'ACCOUNTING_ACCOUNT_CODE_EXISTS':
      return 'errors.accountCodeExists';
    case 'ACCOUNTING_TAX_CODE_EXISTS':
      return 'taxRates.errorCodeExists';
    case 'ACCOUNTING_TAX_RATE_INVALID':
      return 'taxRates.errorRateInvalid';
    case 'INVENTORY_INSUFFICIENT_STOCK':
      return 'errors.insufficientStock';
    default:
      return 'errors.unknown';
  }
}
