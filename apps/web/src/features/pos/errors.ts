/**
 * POS error mapping — backend returns machine codes (CODING_STANDARDS §7),
 * the UI renders i18n keys. Unknown codes fall back to a generic message.
 *
 * Returns keys RELATIVE to the `modules.pos` namespace — every view renders
 * them with `useTranslations('modules.pos')`, so absolute keys would resolve
 * to `modules.pos.modules.pos.errors.*` and break.
 */
export function posErrorKey(code: string): string {
  switch (code) {
    case 'POS_REGISTER_NOT_FOUND':
    case 'POS_SHIFT_NOT_FOUND':
    case 'POS_SALE_NOT_FOUND':
      return 'errors.notFound';
    case 'POS_REGISTER_DUPLICATE_CODE':
      return 'errors.duplicateRegisterCode';
    case 'POS_REGISTER_INACTIVE':
      return 'errors.registerInactive';
    case 'POS_SHIFT_ALREADY_OPEN':
      return 'errors.shiftAlreadyOpen';
    case 'POS_SHIFT_CLOSED_IMMUTABLE':
      return 'errors.shiftClosedImmutable';
    case 'POS_SHIFT_HAS_UNSYNCED_SALES':
      return 'errors.shiftHasUnsyncedSales';
    case 'POS_NO_OPEN_SHIFT':
      return 'errors.noOpenShift';
    case 'POS_REFUND_REQUIRES_OPEN_SHIFT':
      return 'errors.refundRequiresOpenShift';
    case 'POS_PAYMENTS_DO_NOT_EQUAL_TOTAL':
      return 'errors.paymentsDoNotEqualTotal';
    case 'POS_CURRENCY_MISMATCH':
      return 'errors.currencyMismatch';
    case 'POS_DISCOUNT_EXCEEDS_SUBTOTAL':
      return 'errors.discountExceedsSubtotal';
    case 'POS_SALE_IMMUTABLE':
      return 'errors.saleImmutable';
    case 'POS_SALE_NOT_VOIDABLE':
      return 'errors.saleNotVoidable';
    case 'POS_REFUND_SALE_NOT_REFUNDABLE':
      return 'errors.saleNotRefundable';
    case 'POS_REFUND_EXCEEDS_SALE':
      return 'errors.refundExceedsSale';
    case 'POS_REFUND_REQUIRES_REASON':
      return 'errors.refundRequiresReason';
    case 'POS_REFUND_LINE_INVALID':
      return 'errors.refundLineInvalid';
    case 'INVENTORY_INSUFFICIENT_STOCK':
      return 'errors.insufficientStock';
    default:
      return 'errors.unknown';
  }
}
