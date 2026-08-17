// ─── Plan-gated module features (PLAN.md §7.0.1) ────────────────────────────
//
// A module may declare plan-gated features — per-organization toggles that are
// NOT module-level entitlements. The catalog lives here (contracts) so every
// consumer (billing, module use cases, frontend mirrors) reads one source of
// truth:
//
//   - Billing computes the ENABLED SET at enable time and on plan change and
//     stores it on the entitlement row (`core_module_entitlements.features`,
//     BILL-4: the entitlement row is the runtime authority).
//   - Module use cases enforce server-side from that row (OPS-8): a feature
//     that is not enabled behaves as ABSENT. Client-side gating is UX only.
//   - Feature-flag changes are audited (AUD-1).
//
// A feature is addressed as `<moduleKey>.<featureKey>` in catalogs/docs; the
// entitlement's `features jsonb` column stores the SHORT keys of the enabled
// set (each entitlement row is already module-scoped).
//
// @see BUSINESS_RULES.md §13 (ACC-16) and §14 (PUR-12)
// @see DATA_MODEL.md §4.3 — core_module_entitlements.features

export interface ModuleFeature {
  /** Owning module key, e.g. 'accounting'. */
  moduleKey: string;
  /** Short feature key, e.g. 'advanced_coa'. Never module-prefixed. */
  featureKey: string;
  /** Whether the feature is enabled by default when the module is enabled. */
  defaultEnabled: boolean;
}

/** The full plan-gated feature catalog. Billing computes the enabled set from it. */
export const MODULE_FEATURES: readonly ModuleFeature[] = [
  // Accounting & Invoicing (Phase 7)
  { moduleKey: 'accounting', featureKey: 'advanced_coa', defaultEnabled: true },
  { moduleKey: 'accounting', featureKey: 'e_invoicing', defaultEnabled: true },
  // Purchasing & Suppliers (Phase 8)
  { moduleKey: 'purchasing', featureKey: 'purchase_approval', defaultEnabled: false },
] as const;

/**
 * The default-enabled feature keys for a module (short keys) — the set Billing
 * writes to `core_module_entitlements.features` when the module is enabled.
 * Unknown modules yield an empty set (a module with no declared features has no
 * plan-gated toggles).
 */
export function defaultFeaturesForModule(moduleKey: string): string[] {
  return MODULE_FEATURES.filter((f) => f.moduleKey === moduleKey && f.defaultEnabled).map((f) => f.featureKey);
}

/**
 * The full catalog of features a module declares (all keys, enabled or not).
 * Used by admin/billing UI to render toggles for a module's feature set.
 */
export function featuresForModule(moduleKey: string): ModuleFeature[] {
  return MODULE_FEATURES.filter((f) => f.moduleKey === moduleKey);
}
