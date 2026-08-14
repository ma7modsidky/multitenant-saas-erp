import en from '@modubiz/i18n/messages/en';

/**
 * Resolve a module i18n label key (e.g. `modules.crm.name`) to its English
 * value. The platform admin console is intentionally English-only (the API
 * returns name keys, per I18N-2), so admin pages render the `en` catalog
 * directly instead of the active locale. Falls back to the key itself when a
 * catalog entry is missing so a label never renders blank.
 */
export function resolveEnModuleLabel(key: string | null | undefined): string {
  if (!key) return '';
  let node: unknown = en;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return key;
    // Dynamic lookup into a typed message catalog — an object → indexable
    // cast is required for strict access, and the shape is inherently unknown
    // at this point of the walk.
    // eslint-disable-next-line no-restricted-syntax -- dynamic catalog walk, see above
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : key;
}
