import { useTranslations } from 'next-intl';

/** Stable PUR-* error codes → i18n keys (hard rule #4: never raw strings). */
const ERROR_KEY: Record<string, string> = {
  PURCHASING_SUPPLIER_NAME_REQUIRED: 'errors.purchasing.supplierNameRequired',
  PURCHASING_SUPPLIER_TAX_ID_EXISTS: 'errors.purchasing.supplierTaxIdExists',
  PURCHASING_PO_HAS_RECEIPTS: 'errors.purchasing.poHasReceipts',
  PURCHASING_PO_ILLEGAL_TRANSITION: 'errors.purchasing.poIllegalTransition',
  PURCHASING_PO_NOT_APPROVED: 'errors.purchasing.poNotApproved',
  PURCHASING_GRN_EXCEEDS_PO: 'errors.purchasing.grnExceedsPo',
  PURCHASING_GRN_IMMUTABLE: 'errors.purchasing.grnImmutable',
  PURCHASING_BILL_MISSING_GRN: 'errors.purchasing.billMissingGrn',
  PURCHASING_BILL_ILLEGAL_TRANSITION: 'errors.purchasing.billIllegalTransition',
  PURCHASING_PAYMENT_OVER_ALLOCATED: 'errors.purchasing.paymentOverAllocated',
  PURCHASING_RETURN_REASON_REQUIRED: 'errors.purchasing.returnReasonRequired',
  PURCHASING_RETURN_REFERENCE_REQUIRED: 'errors.purchasing.returnReferenceRequired',
  PURCHASING_RETURN_EXCEEDS_BILL: 'errors.purchasing.returnExceedsBill',
  PURCHASING_LEDGER_APPEND_ONLY: 'errors.purchasing.ledgerAppendOnly',
  PURCHASING_NOT_FOUND: 'errors.purchasing.notFound',
  PURCHASING_BILL_NOT_FOUND: 'errors.purchasing.notFound',
  PURCHASING_SUPPLIER_NOT_FOUND: 'errors.purchasing.notFound',
  PURCHASING_PO_NOT_FOUND: 'errors.purchasing.notFound',
};

/** Map a purchasing API error to a translatable message (falls back to common). */
export function usePurchasingError(): (code: string | null | undefined) => string {
  const t = useTranslations();
  return (code) => {
    if (code && ERROR_KEY[code]) return t(ERROR_KEY[code]);
    if (code === 'MODULE_NOT_ENTITLED') return t('errors.moduleNotEntitled');
    if (code === 'FORBIDDEN') return t('errors.forbidden');
    if (code === 'NOT_FOUND') return t('errors.notFound');
    return t('errors.common.unknown');
  };
}
