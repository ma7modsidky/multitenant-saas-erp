import { CrmError, CRM_ERROR_CODE } from './errors.js';

/**
 * Persisted shape of a CRM contact (crm_contacts).
 *
 * Column names mirror the schema in
 * `apps/api/src/modules/crm/db/migrations/0001_init.sql` (DATA_MODEL §7).
 */
export interface ContactData {
  id: string;
  organizationId: string;
  companyId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  ownerUserId: string | null;
  preferredLocale: string | null;
  preferredCurrency: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  deletedAt: Date | null;
}

/**
 * Contact — a person the tenant sells to.
 *
 * Pure TypeScript, no framework imports (hard rule #7).
 *
 * Business rules enforced here:
 * - CRM-1: a contact requires at least one of email or phone.
 * - CRM-2: contact email is unique per organization among non-deleted contacts
 *   (`CRM_CONTACT_DUPLICATE_EMAIL`, offering merge). The DB enforces the same
 *   invariant with a partial unique index on citext email; the domain method
 *   `assertEmailUniqueIn` is the in-process guard the use case calls after
 *   reading existing emails from the repository.
 */
export class Contact {
  private constructor(private readonly data: ContactData) {}

  static create(data: ContactData): Contact {
    assertIdentity(data);
    return new Contact({ ...data });
  }

  /** Reconstruct from persistence (already valid — no invariant re-check). */
  static fromPersistence(data: ContactData): Contact {
    return new Contact(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get companyId(): string | null {
    return this.data.companyId;
  }
  get firstName(): string {
    return this.data.firstName;
  }
  get lastName(): string {
    return this.data.lastName;
  }
  get email(): string | null {
    return this.data.email;
  }
  get phone(): string | null {
    return this.data.phone;
  }
  get secondaryPhone(): string | null {
    return this.data.secondaryPhone;
  }
  get ownerUserId(): string | null {
    return this.data.ownerUserId;
  }
  get preferredLocale(): string | null {
    return this.data.preferredLocale;
  }
  get preferredCurrency(): string | null {
    return this.data.preferredCurrency;
  }
  get deletedAt(): Date | null {
    return this.data.deletedAt;
  }

  /** Get all data as a plain object. */
  toJSON(): ContactData {
    return { ...this.data };
  }

  // ─── Behaviour ──────────────────────────────────────────────────────────────

  /**
   * Update editable identity/profile fields.
   * Re-validates CRM-1 against the resulting values.
   */
  update(props: {
    firstName?: string;
    lastName?: string;
    email?: string | null;
    phone?: string | null;
    secondaryPhone?: string | null;
    companyId?: string | null;
    ownerUserId?: string | null;
    preferredLocale?: string | null;
    preferredCurrency?: string | null;
    updatedBy: string;
  }): void {
    const next = {
      ...this.data,
      firstName: props.firstName ?? this.data.firstName,
      lastName: props.lastName ?? this.data.lastName,
      email: props.email === undefined ? this.data.email : props.email,
      phone: props.phone === undefined ? this.data.phone : props.phone,
      secondaryPhone: props.secondaryPhone === undefined ? this.data.secondaryPhone : props.secondaryPhone,
      companyId: props.companyId === undefined ? this.data.companyId : props.companyId,
      ownerUserId: props.ownerUserId === undefined ? this.data.ownerUserId : props.ownerUserId,
      preferredLocale: props.preferredLocale === undefined ? this.data.preferredLocale : props.preferredLocale,
      preferredCurrency: props.preferredCurrency === undefined ? this.data.preferredCurrency : props.preferredCurrency,
      updatedBy: props.updatedBy,
      updatedAt: new Date(),
    };
    assertIdentity(next);
    Object.assign(this.data, next);
  }

  /**
   * CRM-2: rejects a duplicate email within the organization.
   *
   * The caller passes the set of emails of the org's *other non-deleted*
   * contacts (from the read port). Emails are compared case-insensitively —
   * the column is citext, so 'Ada@X.com' and 'ada@x.com' are the same address.
   *
   * @throws {CrmError} `CRM_CONTACT_DUPLICATE_EMAIL`
   */
  assertEmailUniqueIn(otherOrgEmails: ReadonlySet<string>): void {
    if (this.data.email === null) return;
    const normalized = this.data.email.toLowerCase();
    for (const existing of otherOrgEmails) {
      if (existing.toLowerCase() === normalized) {
        throw new CrmError(
          CRM_ERROR_CODE.CONTACT_DUPLICATE_EMAIL,
          `A contact with email "${this.data.email}" already exists in this organization.`,
          { email: this.data.email },
        );
      }
    }
  }

  /**
   * CRM-11: soft-deletes the contact.
   * Detaching open deals is a use-case concern (the entity only marks deleted_at).
   */
  markDeleted(by: string, at = new Date()): void {
    this.data.deletedAt = at;
    this.data.updatedBy = by;
    this.data.updatedAt = at;
  }
}

/**
 * CRM-1: a contact requires at least one of email or phone.
 */
function assertIdentity(data: ContactData): void {
  if (data.email === null && data.phone === null) {
    throw new CrmError(CRM_ERROR_CODE.CONTACT_REQUIRES_IDENTITY, 'A contact requires at least one of email or phone.');
  }
}
