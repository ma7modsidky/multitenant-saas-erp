import { z } from 'zod';

// ─── Module keys ────────────────────────────────────────────────────────────

/**
 * Stable, permanent module keys.
 * A key must never be renamed — it is used in database records, Stripe metadata, and permissions.
 */
export const MODULE_KEYS = {
  CRM: 'crm',
  INVENTORY: 'inventory',
  POS: 'pos',
} as const;

export type ModuleKey = (typeof MODULE_KEYS)[keyof typeof MODULE_KEYS];

// ─── Permission key ─────────────────────────────────────────────────────────

/**
 * Permission key format: `<module>:<resource>:<action>`
 * Example: `inventory:stock:adjust`
 *
 * @see CODING_STANDARDS.md §2 — Naming conventions
 */
export type PermissionKey = `${ModuleKey}:${string}:${string}`;

// ─── Event name ─────────────────────────────────────────────────────────────

/**
 * Event name format: `<module>.<aggregate>.<pastTenseAction>.v<major>`
 * Example: `inventory.stock.depleted.v1`
 *
 * @see ARCHITECTURE.md §6 — Cross-module communication
 */
export type EventName = `${ModuleKey}.${string}.${string}.v${number}`;

// ─── Navigation item ────────────────────────────────────────────────────────

export interface NavigationItem {
  /** i18n key for the label, e.g. `modules.inventory.nav.products` */
  labelKey: string;
  /** Path relative to the module root, e.g. `/m/inventory/products` */
  href: string;
  /** Optional icon identifier */
  icon?: string;
  /** Nested navigation items */
  children?: NavigationItem[];
}

// ─── Dashboard widget ───────────────────────────────────────────────────────

export interface DashboardWidget {
  /** Unique widget id, scoped to the module */
  id: string;
  /** i18n key for the widget title */
  titleKey: string;
  /** Width in grid columns (1-4) */
  width: 1 | 2 | 3 | 4;
  /** Height in grid rows (1-3) */
  height: 1 | 2 | 3;
}

// ─── Port declaration ───────────────────────────────────────────────────────

export interface PortDeclaration {
  /** Injection token symbol name */
  token: string;
  /** Description of what this port provides */
  description: string;
  /** Whether this port requires a TransactionRef for transactional access */
  transactional: boolean;
}

// ─── Module descriptor ──────────────────────────────────────────────────────

/**
 * ModuleDescriptor — the complete declaration of a module.
 *
 * Every module ships an `inventory.descriptor.ts` that exports a
 * `ModuleDescriptor` created via `defineModule()`.
 *
 * @see MODULE_GUIDE.md §2 — Descriptor rules
 */
export interface ModuleDescriptor {
  /** Stable, permanent key. Never rename. */
  key: ModuleKey | string;

  /** SemVer version of the module */
  version: string;

  /** i18n key for the display name, e.g. `modules.inventory.name` */
  nameKey: string;

  /** i18n key for the description, e.g. `modules.inventory.description` */
  descriptionKey: string;

  /** Icon identifier for the module in navigation and marketplace */
  icon?: string;

  /** Database table prefix (e.g. `inv_`, `crm_`, `pos_`). Must be globally unique. */
  tablePrefix: string;

  /** Module keys this module depends on. Boot fails if not registered. */
  dependsOn: string[];

  /** Stripe price key for subscription billing */
  stripePriceKey: string;

  /** Default trial duration in days. 0 = no trial. */
  trialDays: number;

  /** Permissions this module registers */
  permissions: PermissionKey[];

  /** Navigation items for the sidebar */
  navigation: NavigationItem[];

  /** Events this module publishes */
  publishes: EventName[];

  /** Events this module consumes */
  consumes: EventName[];

  /** Ports this module provides to other modules */
  providesPorts: PortDeclaration[];

  /** Ports this module consumes from other modules */
  consumesPorts: PortDeclaration[];

  /** Whether this module contributes to the federated search */
  searchContributor: boolean;

  /** Dashboard widgets */
  dashboardWidgets: DashboardWidget[];

  /** Seed function called when the module is enabled for an organization */
  onEnableSeed?: string;

  /** Data retention policy in days after module disable/deletion */
  dataRetentionDays: number;
}

// ─── defineModule() helper ─────────────────────────────────────────────────

/**
 * Creates a validated ModuleDescriptor.
 *
 * Validates at definition time:
 * 1. `nameKey` and `descriptionKey` are i18n keys (not display strings)
 * 2. `tablePrefix` ends with `_`
 * 3. Permissions use the module key as prefix
 * 4. Event names use the module key as prefix
 *
 * @throws {Error} if validation fails
 */
export function defineModule(descriptor: ModuleDescriptor): ModuleDescriptor {
  const d = descriptor;

  // Validate name/description are i18n keys
  if (!d.nameKey.startsWith('modules.')) {
    throw new Error(
      `defineModule("${d.key}"): nameKey must be an i18n key starting with "modules.", got "${d.nameKey}"`,
    );
  }
  if (!d.descriptionKey.startsWith('modules.')) {
    throw new Error(
      `defineModule("${d.key}"): descriptionKey must be an i18n key starting with "modules.", got "${d.descriptionKey}"`,
    );
  }

  // Validate table prefix
  if (!d.tablePrefix.endsWith('_')) {
    throw new Error(`defineModule("${d.key}"): tablePrefix must end with "_", got "${d.tablePrefix}"`);
  }
  if (!/^[a-z]+_$/.test(d.tablePrefix)) {
    throw new Error(
      `defineModule("${d.key}"): tablePrefix must be lowercase letters followed by "_", got "${d.tablePrefix}"`,
    );
  }

  // Validate permissions are prefixed with the module key
  for (const perm of d.permissions) {
    if (!perm.startsWith(`${d.key}:`)) {
      throw new Error(`defineModule("${d.key}"): permission "${perm}" must start with the module key "${d.key}:".`);
    }
  }

  // Validate published events are prefixed with the module key
  // e.g., inventory module publishes events starting with "inventory."
  for (const event of d.publishes) {
    if (!event.startsWith(`${d.key}.`)) {
      throw new Error(
        `defineModule("${d.key}"): published event "${event}" must start with the module key "${d.key}.".`,
      );
    }
  }

  // NOTE: Consumed events are NOT validated against the module key.
  // A module consumes events published by OTHER modules.
  // E.g., POS consuming "inventory.stock.depleted.v1" (starts with "inventory", not "pos").
  // Validation of consumed events is done at boot time when all module descriptors
  // are registered and the registry checks that each consumed event is published by
  // exactly one registered module.

  return Object.freeze({ ...d });
}
