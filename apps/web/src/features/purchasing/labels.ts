/** Formats minor units as a localized currency string (exponent-aware). */
export function formatMinorAmount(
  amountMinor: string,
  currency: string,
  options: { locale: string; exponent?: number },
): string {
  const exponent = options.exponent ?? 2;
  const major = Number(amountMinor) / 10 ** exponent;
  try {
    return new Intl.NumberFormat(options.locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: exponent,
    }).format(major);
  } catch {
    return `${amountMinor} ${currency}`;
  }
}

/** Signed minor units (bills +, payments −, debit notes −) for the ledger. */
export function formatSignedMinor(amountMinor: string, currency: string, locale: string, exponent: number): string {
  const negative = amountMinor.startsWith('-');
  const abs = negative ? amountMinor.slice(1) : amountMinor;
  const base = formatMinorAmount(abs, currency, { locale, exponent });
  return negative ? `−${base}` : base;
}

/** Decimal quantity for display (numeric(18,4) stored as string). */
export function formatQuantity(quantity: string): string {
  const trimmed = quantity.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed || '0';
}

/** The Bill/PO status tone for badges. */
export function statusTone(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'draft':
    case 'pending_approval':
      return 'secondary';
    case 'approved':
    case 'received':
    case 'paid':
      return 'default';
    case 'partially_received':
    case 'partially_paid':
      return 'outline';
    case 'cancelled':
    case 'void':
      return 'destructive';
    default:
      return 'secondary';
  }
}
