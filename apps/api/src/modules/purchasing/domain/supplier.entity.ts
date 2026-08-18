import { PURCHASING_ERROR_CODE, PurchasingDomainError } from './errors.js';

export interface PaymentTerms {
  /** Net payment days (PUR-10: bill due date = bill date + net_days). */
  netDays: number;
  /** Early-payment discount window in days. */
  discountDays: number;
  /** Early-payment discount rate in basis points (1% = 100 bp). */
  discountRateBp: number;
}

export const DEFAULT_PAYMENT_TERMS: PaymentTerms = { netDays: 30, discountDays: 0, discountRateBp: 0 };

export interface SupplierData {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  taxId: string | null;
  paymentTerms: PaymentTerms;
  currency: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: Record<string, unknown> | null;
  bankAccount: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInput {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  taxId?: string | null;
  paymentTerms?: PaymentTerms;
  currency?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: Record<string, unknown> | null;
  bankAccount?: Record<string, unknown> | null;
  now?: Date;
}

/** A payment-terms object is valid when net days ≥ 0 and rates are in range. */
export function normalizePaymentTerms(terms: PaymentTerms | undefined): PaymentTerms {
  const t = terms ?? DEFAULT_PAYMENT_TERMS;
  return {
    netDays: Math.max(0, Math.trunc(t.netDays ?? 0)),
    discountDays: Math.max(0, Math.trunc(t.discountDays ?? 0)),
    discountRateBp: Math.max(0, Math.trunc(t.discountRateBp ?? 0)),
  };
}

/**
 * Supplier — the supplier directory master (PUR-1).
 *
 * PUR-1: a supplier requires a name; a tax id, when provided, must be unique
 * per organization (enforced by a partial unique index in the DB and by the
 * create/update use cases). The directory records payment terms (PUR-10), tax
 * id, contact details, default billing currency, and address.
 */
export class Supplier {
  private constructor(private readonly data: SupplierData) {}

  static create(input: SupplierInput): Supplier {
    if (!input.name || input.name.trim() === '') {
      throw new PurchasingDomainError(
        PURCHASING_ERROR_CODE.SUPPLIER_NAME_REQUIRED,
        'A supplier requires a name (PUR-1).',
      );
    }
    const timestamp = (input.now ?? new Date()).toISOString();
    return new Supplier({
      id: input.id,
      organizationId: input.organizationId,
      code: input.code,
      name: input.name.trim(),
      taxId: input.taxId ? input.taxId.trim() : null,
      paymentTerms: normalizePaymentTerms(input.paymentTerms),
      currency: (input.currency ?? 'USD').toUpperCase(),
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      address: input.address ?? null,
      bankAccount: input.bankAccount ?? null,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  static fromJSON(data: SupplierData): Supplier {
    return new Supplier(data);
  }

  toJSON(): SupplierData {
    return { ...this.data, paymentTerms: { ...this.data.paymentTerms } };
  }

  get id(): string {
    return this.data.id;
  }

  get organizationId(): string {
    return this.data.organizationId;
  }

  get name(): string {
    return this.data.name;
  }

  get taxId(): string | null {
    return this.data.taxId;
  }

  get currency(): string {
    return this.data.currency;
  }

  get paymentTerms(): PaymentTerms {
    return { ...this.data.paymentTerms };
  }

  get isActive(): boolean {
    return this.data.isActive;
  }

  /** PUR-1: rename + directory fields; the code is permanent. */
  update(input: {
    name?: string;
    taxId?: string | null;
    paymentTerms?: PaymentTerms;
    currency?: string;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    address?: Record<string, unknown> | null;
    bankAccount?: Record<string, unknown> | null;
    isActive?: boolean;
    now?: Date;
  }): void {
    if (input.name !== undefined) {
      if (!input.name.trim()) {
        throw new PurchasingDomainError(
          PURCHASING_ERROR_CODE.SUPPLIER_NAME_REQUIRED,
          'A supplier requires a name (PUR-1).',
        );
      }
      this.data.name = input.name.trim();
    }
    if (input.taxId !== undefined) this.data.taxId = input.taxId ? input.taxId.trim() : null;
    if (input.paymentTerms !== undefined) this.data.paymentTerms = normalizePaymentTerms(input.paymentTerms);
    if (input.currency !== undefined) this.data.currency = input.currency.toUpperCase();
    if (input.contactName !== undefined) this.data.contactName = input.contactName;
    if (input.contactEmail !== undefined) this.data.contactEmail = input.contactEmail;
    if (input.contactPhone !== undefined) this.data.contactPhone = input.contactPhone;
    if (input.address !== undefined) this.data.address = input.address;
    if (input.bankAccount !== undefined) this.data.bankAccount = input.bankAccount;
    if (input.isActive !== undefined) this.data.isActive = input.isActive;
    this.data.updatedAt = (input.now ?? new Date()).toISOString();
  }
}
