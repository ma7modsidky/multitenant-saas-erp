import { describe, expect, it } from 'vitest';

import { checkPermission, createAbility } from '../ability.factory.js';

describe('createAbility', () => {
  it('grants access for an exact permission match', () => {
    const ability = createAbility(['inventory:product:read']);

    expect(ability.can('read', 'inventory:product')).toBe(true);
  });

  it('denies access for a missing permission', () => {
    const ability = createAbility(['inventory:product:read']);

    expect(ability.can('update', 'inventory:product')).toBe(false);
    expect(ability.can('delete', 'inventory:product')).toBe(false);
  });

  it('handles multiple permissions', () => {
    const ability = createAbility(['inventory:product:read', 'inventory:product:write', 'inventory:stock:adjust']);

    expect(ability.can('read', 'inventory:product')).toBe(true);
    expect(ability.can('write', 'inventory:product')).toBe(true);
    expect(ability.can('adjust', 'inventory:stock')).toBe(true);
    expect(ability.can('delete', 'inventory:product')).toBe(false);
  });

  it('AUTHZ-5: grants manage action for all specified module resources', () => {
    const ability = createAbility(['crm:contact:manage']);

    expect(ability.can('create', 'crm:contact')).toBe(true);
    expect(ability.can('read', 'crm:contact')).toBe(true);
    expect(ability.can('update', 'crm:contact')).toBe(true);
    expect(ability.can('delete', 'crm:contact')).toBe(true);
  });

  it('does not grant permission across different modules', () => {
    const ability = createAbility(['inventory:product:read']);

    expect(ability.can('read', 'crm:contact')).toBe(false);
    expect(ability.can('read', 'pos:sale')).toBe(false);
  });

  it('does not grant permission for different resources in the same module', () => {
    const ability = createAbility(['inventory:product:read']);

    expect(ability.can('read', 'inventory:stock')).toBe(false);
  });

  it('handles an empty permission list', () => {
    const ability = createAbility([]);

    expect(ability.can('read', 'inventory:product')).toBe(false);
  });

  it('skips invalid permission formats silently', () => {
    const ability = createAbility(['invalid', 'too:many:parts:here', 'inventory:product:read']);

    // The valid permission should still work
    expect(ability.can('read', 'inventory:product')).toBe(true);
  });

  it('differentiates between read and write access', () => {
    const ability = createAbility(['inventory:product:read']);

    expect(ability.can('read', 'inventory:product')).toBe(true);
    expect(ability.can('update', 'inventory:product')).toBe(false);
    expect(ability.can('delete', 'inventory:product')).toBe(false);
    expect(ability.can('create', 'inventory:product')).toBe(false);
  });

  it('handles permission with all three action types per module prefix', () => {
    const ability = createAbility(['inventory:product:read', 'inventory:stock:read', 'inventory:product:write']);

    expect(ability.can('read', 'inventory:product')).toBe(true);
    expect(ability.can('write', 'inventory:product')).toBe(true);
    expect(ability.can('delete', 'inventory:product')).toBe(false);
    expect(ability.can('read', 'inventory:stock')).toBe(true);
    expect(ability.can('write', 'inventory:stock')).toBe(false);
  });
});

describe('checkPermission', () => {
  it('AUTHZ-5: returns true when the user has the permission', () => {
    const result = checkPermission(['inventory:product:read', 'inventory:product:write'], 'read', 'inventory:product');

    expect(result).toBe(true);
  });

  it('AUTHZ-5: returns false when the user lacks the permission', () => {
    const result = checkPermission(['inventory:product:read'], 'delete', 'inventory:product');

    expect(result).toBe(false);
  });

  it('returns true for manage permission', () => {
    const result = checkPermission(['crm:contact:manage'], 'delete', 'crm:contact');

    expect(result).toBe(true);
  });
});
