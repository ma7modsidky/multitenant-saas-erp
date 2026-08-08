/**
 * Inventory error mapping — backend returns machine codes (CODING_STANDARDS
 * §7), the UI renders i18n keys. Unknown codes fall back to a generic message.
 *
 * Returns keys RELATIVE to the `modules.inventory` namespace — every view
 * renders them with `useTranslations('modules.inventory')`, so absolute keys
 * would resolve to `modules.inventory.modules.inventory.errors.*` and break.
 */
export function inventoryErrorKey(code: string): string {
  switch (code) {
    case 'INVENTORY_VARIANT_DUPLICATE_SKU':
      return 'errors.duplicateSku';
    case 'INVENTORY_INSUFFICIENT_STOCK':
      return 'errors.insufficientStock';
    case 'INVENTORY_ADJUSTMENT_REQUIRES_REASON':
      return 'errors.adjustmentRequiresReason';
    case 'INVENTORY_NEGATIVE_STOCK_NOT_ALLOWED':
      return 'errors.negativeStock';
    case 'INVENTORY_STOCK_COUNT_APPLIED_IMMUTABLE':
      return 'errors.countApplied';
    case 'INVENTORY_WAREHOUSE_DUPLICATE_CODE':
      return 'errors.duplicateWarehouseCode';
    case 'PRODUCT_NOT_FOUND':
    case 'VARIANT_NOT_FOUND':
    case 'WAREHOUSE_NOT_FOUND':
    case 'STOCK_COUNT_NOT_FOUND':
      return 'errors.notFound';
    default:
      return 'errors.unknown';
  }
}
