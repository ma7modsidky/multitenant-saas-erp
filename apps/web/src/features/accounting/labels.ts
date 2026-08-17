/**
 * Display helpers for the accounting feature.
 *
 * Money is ALWAYS integer minor units as strings (hard rule #3) — these
 * helpers format minor units for display and resolve translatable names,
 * mirroring the POS feature's self-contained helpers.
 */

/** Resolves a translatable name for the active locale, falling back to `en`. */
export function localizedLabel(
  nameI18n: Record<string, string> | null | undefined,
  locale: string,
  fallback = '—',
): string {
  if (!nameI18n) return fallback;
  return nameI18n[locale] ?? nameI18n.en ?? fallback;
}

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

/** Sums minor-unit amounts (same currency) exactly. */
export function sumMinorAmounts(amounts: string[]): string {
  return amounts.reduce((total, amount) => total + BigInt(amount || '0'), 0n).toString();
}

/**
 * Seeded SME chart name keys (ACC-5). The backend stores these technical keys
 * as the system accounts' display text; the UI translates them instead of
 * showing `coa.bank`-style keys to users.
 */
const SEEDED_COA_KEYS = new Set([
  'coa.cash',
  'coa.bank',
  'coa.accounts_receivable',
  'coa.inventory',
  'coa.accounts_payable',
  'coa.vat_payable',
  'coa.owner_equity',
  'coa.revenue',
  'coa.service_revenue',
  'coa.cogs',
  'coa.operating_expense',
]);

/**
 * Resolve an account's display name. Accounts seeded with a technical key
 * (`coa.bank`, …) are translated via the `coa.seeded.*` catalog; custom
 * accounts and renamed accounts use their stored nameI18n directly. A custom
 * account can never legitimately carry a seeded key — the Add Account form
 * rejects technical keys — so matching the key alone is safe.
 *
 * @param translate - `useTranslations('modules.accounting')` bound t function
 */
export function accountDisplayName(
  account: { nameI18n: Record<string, string> | null | undefined },
  locale: string,
  translate: (key: string) => string,
): string {
  const enName = account.nameI18n?.en ?? '';
  if (SEEDED_COA_KEYS.has(enName)) {
    return translate(`coa.seeded.${enName.slice('coa.'.length)}`);
  }
  return localizedLabel(account.nameI18n, locale);
}

/** Account types whose NATURAL balance is a credit (liability/equity/revenue). */
const CREDIT_NORMAL_TYPES = new Set(['liability', 'equity', 'revenue']);

/**
 * The account's net balance expressed in its NATURAL direction (positive).
 * `netMinor` is signed debit − credit (from the API). For credit-normal
 * accounts the sign flips so a positive balance means "in credit".
 */
export function naturalBalance(netMinor: string, accountType: string): string {
  const net = BigInt(netMinor || '0');
  const natural = CREDIT_NORMAL_TYPES.has(accountType) ? -net : net;
  return natural < 0n ? (-natural).toString() : natural.toString();
}

/**
 * Which side an account's balance sits on (Dr for debit-normal types).
 * `netMinor` is signed debit − credit; a zero balance reports the type's
 * normal side.
 */
export function balanceSide(netMinor: string, accountType: string): 'debit' | 'credit' {
  const net = BigInt(netMinor || '0');
  const creditNormal = CREDIT_NORMAL_TYPES.has(accountType);
  if (net === 0n) return creditNormal ? 'credit' : 'debit';
  const natural = creditNormal ? -net : net;
  return natural > 0n ? (creditNormal ? 'credit' : 'debit') : creditNormal ? 'debit' : 'credit';
}

/**
 * Running balance (signed debit − credit) displayed in the account's natural
 * direction — positive when the balance is on the account's normal side.
 */
export function naturalRunningBalance(runningMinor: string, accountType: string): string {
  const running = BigInt(runningMinor || '0');
  const natural = CREDIT_NORMAL_TYPES.has(accountType) ? -running : running;
  return natural < 0n ? `-${(-natural).toString()}` : natural.toString();
}
