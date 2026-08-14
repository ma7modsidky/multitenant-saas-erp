import { describe, expect, it } from 'vitest';

import { resolveEnModuleLabel } from '../module-labels';

describe('resolveEnModuleLabel (admin console, English-only)', () => {
  it('resolves a registered module name key to its English label', () => {
    expect(resolveEnModuleLabel('modules.crm.name')).toBe('CRM');
    expect(resolveEnModuleLabel('modules.inventory.name')).toBe('Inventory');
    expect(resolveEnModuleLabel('modules.pos.name')).toBe('POS');
  });

  it('resolves nested keys and descriptions', () => {
    expect(resolveEnModuleLabel('modules.crm.nav.contacts')).toBe('Contacts');
    expect(resolveEnModuleLabel('modules.crm.description')).toBe('Manage contacts, companies, deals, and pipeline');
  });

  it('falls back to the key when the catalog has no entry', () => {
    expect(resolveEnModuleLabel('modules.unknown.name')).toBe('modules.unknown.name');
  });

  it('handles null/undefined/empty input', () => {
    expect(resolveEnModuleLabel(null)).toBe('');
    expect(resolveEnModuleLabel(undefined)).toBe('');
    expect(resolveEnModuleLabel('')).toBe('');
  });
});
