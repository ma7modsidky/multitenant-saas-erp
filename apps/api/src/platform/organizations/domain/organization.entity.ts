import { DomainError } from '../../../core/common/errors.js';

/**
 * Organization status values.
 *
 * - `active`: Normal operating state
 * - `suspended`: Access temporarily revoked (e.g., payment failure)
 * - `pending_deletion`: 30-day grace period before permanent deletion (GDPR-2)
 */
export type OrganizationStatus = 'active' | 'suspended' | 'pending_deletion';

/**
 * Organization entity data (persisted to core_organizations).
 *
 * NOTE: core_organizations is a GLOBAL (non-tenant) table — it has no
 * organization_id column because the organization IS the tenant.
 * RLS does not apply; access is governed by membership queries.
 *
 * @see DATA_MODEL.md §4.1 — Global (non-tenant) tables
 */
export interface OrganizationData {
  id: string;
  name: string;
  slug: string;
  countryCode: string;
  timezone: string;
  baseCurrency: string;
  defaultLocale: string;
  status: OrganizationStatus;
  deletionScheduledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Organization — domain entity for tenant organizations.
 *
 * An organization is the top-level tenant in the system. Users belong to
 * organizations through memberships, and all business data is scoped to
 * exactly one organization via RLS.
 *
 * Business rules enforced:
 * - AUTH-10: The user who creates an org becomes its OWNER (enforced by use case)
 * - CUR-1: Base currency is immutable once any monetary row exists (enforced by use case)
 * - GDPR-2: Deleting an org starts a 30-day grace period
 */
export class Organization {
  private constructor(private readonly data: OrganizationData) {}

  static create(data: OrganizationData): Organization {
    return new Organization(data);
  }

  /** Reconstruct from persistence. */
  static fromPersistence(data: OrganizationData): Organization {
    return new Organization(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get name(): string {
    return this.data.name;
  }
  get slug(): string {
    return this.data.slug;
  }
  get countryCode(): string {
    return this.data.countryCode;
  }
  get timezone(): string {
    return this.data.timezone;
  }
  get baseCurrency(): string {
    return this.data.baseCurrency;
  }
  get defaultLocale(): string {
    return this.data.defaultLocale;
  }
  get status(): OrganizationStatus {
    return this.data.status;
  }
  get deletionScheduledAt(): Date | null {
    return this.data.deletionScheduledAt;
  }
  get createdAt(): Date {
    return this.data.createdAt;
  }
  get updatedAt(): Date {
    return this.data.updatedAt;
  }

  /** Get all data as a plain object. */
  toJSON(): OrganizationData {
    return { ...this.data };
  }

  // ─── Behaviour ──────────────────────────────────────────────────────────────

  /**
   * Update profile fields.
   * Does NOT validate base currency immutability — that is checked by the use case
   * against monetary row existence (CUR-1).
   */
  updateProfile(props: {
    name?: string;
    countryCode?: string;
    timezone?: string;
    baseCurrency?: string;
    defaultLocale?: string;
  }): void {
    if (props.name !== undefined) {
      this.data.name = props.name;
    }
    if (props.countryCode !== undefined) {
      this.data.countryCode = props.countryCode;
    }
    if (props.timezone !== undefined) {
      this.data.timezone = props.timezone;
    }
    if (props.baseCurrency !== undefined) {
      this.data.baseCurrency = props.baseCurrency;
    }
    if (props.defaultLocale !== undefined) {
      this.data.defaultLocale = props.defaultLocale;
    }
  }

  /**
   * Initiate soft-delete with 30-day grace period (GDPR-2).
   *
   * The org status moves to 'pending_deletion'. The actual deletion
   * happens after the grace period via a background job.
   */
  scheduleDeletion(): void {
    if (this.data.status === 'pending_deletion') {
      throw new OrganizationError('ORG_ALREADY_PENDING_DELETION', 'Organization is already pending deletion');
    }

    if (this.data.status === 'suspended') {
      throw new OrganizationError('ORG_CANNOT_DELETE_SUSPENDED', 'A suspended organization cannot be deleted. Reactivate first.');
    }

    this.data.status = 'pending_deletion';
    // 30-day grace period from now
    this.data.deletionScheduledAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }

  /**
   * Cancel a pending deletion and restore to active (GDPR-2).
   */
  cancelDeletion(): void {
    if (this.data.status !== 'pending_deletion') {
      throw new OrganizationError('ORG_NOT_PENDING_DELETION', 'Organization is not pending deletion');
    }

    this.data.status = 'active';
    this.data.deletionScheduledAt = null;
  }

  /**
   * Check if the base currency can be changed.
   * Throws if organization has monetary records (CUR-1).
   */
  assertBaseCurrencyMutable(hasMonetaryRecords: boolean): void {
    if (hasMonetaryRecords) {
      throw new OrganizationError(
        'BASE_CURRENCY_IMMUTABLE',
        'Base currency cannot be changed once any monetary record exists for the organization.',
      );
    }
  }
}

/**
 * Organization-specific domain error.
 * Extends DomainError (→ 422) so the global exception filter maps it properly.
 */
export class OrganizationError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message, { code });
    this.name = 'OrganizationError';
  }
}
