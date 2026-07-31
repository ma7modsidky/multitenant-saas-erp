import { describe, expect, it } from 'vitest';

import { hasPermission } from '../index';

describe('hasPermission', () => {
  it('AUTHZ-2: grants an exact key', () => {
    expect(hasPermission(['crm:contact:read'], 'crm:contact:read')).toBe(true);
  });

  it('AUTHZ-2: denies an unrelated key', () => {
    expect(hasPermission(['crm:contact:read'], 'crm:contact:write')).toBe(false);
  });

  it('AUTHZ-2: `manage` on a resource implies every action on it', () => {
    expect(hasPermission(['crm:contact:manage'], 'crm:contact:read')).toBe(true);
    expect(hasPermission(['crm:contact:manage'], 'crm:contact:delete')).toBe(true);
  });

  it('AUTHZ-2: `module:manage` implies any resource/action in the module', () => {
    expect(hasPermission(['crm:manage'], 'crm:deal:read')).toBe(true);
  });

  it('AUTHZ-2: module wildcard resource `*` implies every action', () => {
    expect(hasPermission(['crm:*'], 'crm:contact:read')).toBe(true);
  });

  it('AUTHZ-2: global `*` implies everything', () => {
    expect(hasPermission(['*'], 'platform:organization:delete')).toBe(true);
  });

  it('AUTHZ-2: resource mismatch is denied even with a same-module key', () => {
    expect(hasPermission(['crm:company:read'], 'crm:contact:read')).toBe(false);
  });

  it('AUTHZ-2: required `*` is always granted', () => {
    expect(hasPermission([], '*')).toBe(true);
  });
});
