/**
 * Organization settings value object.
 *
 * Represents the configurable settings for an organization:
 * locale, timezone, base currency, and formatting preferences.
 *
 * Persisted to core_organization_settings (one row per org).
 * RLS-protected tenant table.
 *
 * @see DATA_MODEL.md §4.2 — core_organization_settings
 */
export interface OrganizationSettingsData {
  id: string;
  organizationId: string;
  locale: string;
  timezone: string;
  baseCurrency: string;
  numberPreferences: Record<string, unknown>;
  datePreferences: Record<string, unknown>;
  receiptFooter: string | null;
  /** The organization's seller/company tax ID (ACC-6 — invoice header). */
  sellerTaxId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * OrganizationSettings — immutable value object wrapping org settings.
 */
export class OrganizationSettings {
  private constructor(private readonly data: OrganizationSettingsData) {}

  static create(data: OrganizationSettingsData): OrganizationSettings {
    return new OrganizationSettings(data);
  }

  static fromPersistence(data: OrganizationSettingsData): OrganizationSettings {
    return new OrganizationSettings(data);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.data.id;
  }
  get organizationId(): string {
    return this.data.organizationId;
  }
  get locale(): string {
    return this.data.locale;
  }
  get timezone(): string {
    return this.data.timezone;
  }
  get baseCurrency(): string {
    return this.data.baseCurrency;
  }
  get numberPreferences(): Record<string, unknown> {
    return { ...this.data.numberPreferences };
  }
  get datePreferences(): Record<string, unknown> {
    return { ...this.data.datePreferences };
  }
  get receiptFooter(): string | null {
    return this.data.receiptFooter;
  }
  get sellerTaxId(): string | null {
    return this.data.sellerTaxId;
  }
  get createdAt(): Date {
    return this.data.createdAt;
  }
  get updatedAt(): Date {
    return this.data.updatedAt;
  }

  /** Get all data as a plain object. */
  toJSON(): OrganizationSettingsData {
    return { ...this.data };
  }
}

/**
 * Default organization settings for new organizations.
 */
export function defaultOrganizationSettings(organizationId: string, baseCurrency: string): OrganizationSettingsData {
  return {
    id: crypto.randomUUID(),
    organizationId,
    locale: 'en',
    timezone: 'UTC',
    baseCurrency,
    numberPreferences: {},
    datePreferences: {},
    receiptFooter: null,
    sellerTaxId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
