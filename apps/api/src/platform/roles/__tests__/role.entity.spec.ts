import { ALL_PERMISSIONS } from '@modubiz/contracts';
import { describe, expect, it } from 'vitest';

import {
  Role,
  RoleError,
  SYSTEM_ROLES,
  SYSTEM_ROLE_PERMISSIONS,
  PLATFORM_PERMISSIONS,
  SYSTEM_ROLE_IMMUTABLE,
  LAST_OWNER_ROLE,
  CUSTOM_ROLE_PLATFORM_PERMISSION_DENIED,
  type RoleData,
} from '../domain/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOwnerRoleData(overrides: Partial<RoleData> = {}): RoleData {
  return {
    id: 'role-owner-1',
    organizationId: 'org-1',
    key: SYSTEM_ROLES.OWNER,
    nameI18n: { en: 'Owner', ar: 'مالك' },
    description: 'Full access to all platform features',
    isSystem: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    ...overrides,
  };
}

function makeAdminRoleData(overrides: Partial<RoleData> = {}): RoleData {
  return {
    id: 'role-admin-1',
    organizationId: 'org-1',
    key: SYSTEM_ROLES.ADMIN,
    nameI18n: { en: 'Admin', ar: 'مدير' },
    description: 'Administrative access',
    isSystem: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    ...overrides,
  };
}

function makeCustomRoleData(overrides: Partial<RoleData> = {}): RoleData {
  return {
    id: 'role-custom-1',
    organizationId: 'org-1',
    key: 'sales_manager',
    nameI18n: { en: 'Sales Manager', ar: 'مدير مبيعات' },
    description: 'Manages sales team',
    isSystem: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    createdBy: 'user-1',
    updatedBy: 'user-1',
    deletedAt: null,
    ...overrides,
  };
}

// ─── Helper: assert error code from RoleError ───────────────────────────────

function expectRoleError(action: () => void, expectedCode: string): void {
  try {
    action();
    expect.fail('Expected RoleError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(RoleError);
    expect((error as RoleError).code).toBe(expectedCode);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SYSTEM_ROLES constants', () => {
  it('defines exactly 5 system role keys', () => {
    const keys = Object.values(SYSTEM_ROLES);
    expect(keys).toHaveLength(5);
    expect(keys).toContain('owner');
    expect(keys).toContain('admin');
    expect(keys).toContain('manager');
    expect(keys).toContain('member');
    expect(keys).toContain('viewer');
  });

  it('all keys are lowercase strings', () => {
    for (const key of Object.values(SYSTEM_ROLES)) {
      expect(key).toEqual(key.toLowerCase());
    }
  });
});

describe('PLATFORM_PERMISSIONS', () => {
  it('defines platform permissions reserved for OWNER/ADMIN (AUTHZ-4)', () => {
    expect(PLATFORM_PERMISSIONS).toContain('platform:organization:delete');
    expect(PLATFORM_PERMISSIONS).toContain('platform:ownership:transfer');
    expect(PLATFORM_PERMISSIONS).toContain('platform:billing:manage');
    expect(PLATFORM_PERMISSIONS).toContain('platform:modules:enable');
    expect(PLATFORM_PERMISSIONS).toContain('platform:modules:disable');
    expect(PLATFORM_PERMISSIONS).toContain('platform:members:invite');
    expect(PLATFORM_PERMISSIONS).toContain('platform:members:remove');
    expect(PLATFORM_PERMISSIONS).toContain('platform:roles:manage');
    expect(PLATFORM_PERMISSIONS).toContain('platform:settings:manage');
    expect(PLATFORM_PERMISSIONS).toContain('platform:audit:view');
  });
});

describe('SYSTEM_ROLE_PERMISSIONS role matrix', () => {
  it('owner has all platform permissions plus data access', () => {
    const ownerPerms = SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.OWNER];
    expect(ownerPerms).toBeDefined();

    // All PLATFORM_PERMISSIONS are included
    for (const perm of PLATFORM_PERMISSIONS) {
      expect(ownerPerms).toContain(perm);
    }

    // Data access permissions
    expect(ownerPerms).toContain('platform:data:write');
    expect(ownerPerms).toContain('platform:data:read');
    expect(ownerPerms).toContain('platform:data:export');
    expect(ownerPerms).toContain('platform:module:configure');
  });

  it('admin has platform permissions except org:delete and ownership:transfer', () => {
    const adminPerms = SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.ADMIN];
    expect(adminPerms).toBeDefined();

    // Admin has billing, modules, members, roles, settings, audit
    expect(adminPerms).toContain('platform:billing:manage');
    expect(adminPerms).toContain('platform:modules:enable');
    expect(adminPerms).toContain('platform:modules:disable');
    expect(adminPerms).toContain('platform:members:invite');
    expect(adminPerms).toContain('platform:members:remove');
    expect(adminPerms).toContain('platform:roles:manage');
    expect(adminPerms).toContain('platform:settings:manage');
    expect(adminPerms).toContain('platform:audit:view');

    // Admin does NOT have org-level destructive permissions
    expect(adminPerms).not.toContain('platform:organization:delete');
    expect(adminPerms).not.toContain('platform:ownership:transfer');

    // Admin has data access
    expect(adminPerms).toContain('platform:data:write');
    expect(adminPerms).toContain('platform:data:read');
    expect(adminPerms).toContain('platform:data:export');
    expect(adminPerms).toContain('platform:module:configure');
  });

  it('manager has module and data access only', () => {
    const managerPerms = SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.MANAGER];
    expect(managerPerms).toBeDefined();

    expect(managerPerms).toContain('platform:module:configure');
    expect(managerPerms).toContain('platform:data:write');
    expect(managerPerms).toContain('platform:data:read');
    expect(managerPerms).toContain('platform:data:export');

    // Manager does NOT have any platform admin permissions
    for (const perm of PLATFORM_PERMISSIONS) {
      expect(managerPerms).not.toContain(perm);
    }
  });

  it('member has data write and read only', () => {
    const memberPerms = SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.MEMBER];
    expect(memberPerms).toBeDefined();

    expect(memberPerms).toContain('platform:data:write');
    expect(memberPerms).toContain('platform:data:read');

    expect(memberPerms).not.toContain('platform:data:export');
    expect(memberPerms).not.toContain('platform:module:configure');

    // No platform admin permissions
    for (const perm of PLATFORM_PERMISSIONS) {
      expect(memberPerms).not.toContain(perm);
    }
  });

  it('viewer has read-only access', () => {
    const viewerPerms = SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.VIEWER];
    expect(viewerPerms).toBeDefined();

    expect(viewerPerms).toContain('platform:data:read');

    expect(viewerPerms).not.toContain('platform:data:write');
    expect(viewerPerms).not.toContain('platform:data:export');
    expect(viewerPerms).not.toContain('platform:module:configure');

    // No platform admin permissions
    for (const perm of PLATFORM_PERMISSIONS) {
      expect(viewerPerms).not.toContain(perm);
    }
  });

  it('role permissions are strictly increasing: viewer ⊂ member ⊂ manager ⊂ admin ⊂ owner', () => {
    const levels = [
      SYSTEM_ROLES.VIEWER,
      SYSTEM_ROLES.MEMBER,
      SYSTEM_ROLES.MANAGER,
      SYSTEM_ROLES.ADMIN,
      SYSTEM_ROLES.OWNER,
    ];

    for (let i = 0; i < levels.length - 1; i++) {
      const lower = SYSTEM_ROLE_PERMISSIONS[levels[i]!]!;
      const higher = SYSTEM_ROLE_PERMISSIONS[levels[i + 1]!]!;

      // All lower permissions are in higher
      for (const perm of lower) {
        expect(higher).toContain(perm);
      }

      // Higher has at least one permission lower doesn't
      const extra = higher.filter((p) => !lower.includes(p));
      expect(extra.length).toBeGreaterThan(0);
    }
  });
});

describe('SYSTEM_ROLE_PERMISSIONS — module permission grants (BUSINESS_RULES §3)', () => {
  const modulePermissions = Object.values(ALL_PERMISSIONS);

  it('every registered module permission is granted to OWNER and ADMIN', () => {
    for (const roleKey of [SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN]) {
      const perms = SYSTEM_ROLE_PERMISSIONS[roleKey]!;
      for (const perm of modulePermissions) {
        expect(perms).toContain(perm);
      }
    }
  });

  it('MANAGER receives module configuration (pipelines) and data permissions', () => {
    const managerPerms = SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.MANAGER]!;
    expect(managerPerms).toContain('crm:contact:read');
    expect(managerPerms).toContain('crm:deal:write');
    // Module configuration (pipelines) is granted to MANAGER per the matrix.
    expect(managerPerms).toContain('crm:pipeline:manage');
  });

  it('MEMBER has module data read/write but no module configuration', () => {
    const memberPerms = SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.MEMBER]!;
    expect(memberPerms).toContain('crm:contact:read');
    expect(memberPerms).toContain('crm:contact:write');
    expect(memberPerms).toContain('crm:deal:write');
    expect(memberPerms).not.toContain('crm:pipeline:manage');
    expect(memberPerms).not.toContain('inventory:warehouse:write');
  });

  it('VIEWER has module data read only', () => {
    const viewerPerms = SYSTEM_ROLE_PERMISSIONS[SYSTEM_ROLES.VIEWER]!;
    expect(viewerPerms).toContain('crm:contact:read');
    expect(viewerPerms).toContain('crm:deal:read');
    expect(viewerPerms).not.toContain('crm:contact:write');
    expect(viewerPerms).not.toContain('crm:pipeline:manage');
  });
});

describe('Role.create()', () => {
  it('creates a role from data', () => {
    const data = makeCustomRoleData();
    const role = Role.create(data);

    expect(role.id).toBe('role-custom-1');
    expect(role.key).toBe('sales_manager');
    expect(role.isSystem).toBe(false);
    expect(role.isOwnerRole).toBe(false);
    expect(role.isDeletable).toBe(true);
  });

  it('identifies an OWNER role via isOwnerRole', () => {
    const owner = Role.create(makeOwnerRoleData());
    expect(owner.isOwnerRole).toBe(true);

    const admin = Role.create(makeAdminRoleData());
    expect(admin.isOwnerRole).toBe(false);
  });
});

describe('Role.fromPersistence()', () => {
  it('restores a role from stored data', () => {
    const data = makeAdminRoleData();
    const role = Role.fromPersistence(data);

    expect(role.key).toBe(SYSTEM_ROLES.ADMIN);
    expect(role.isSystem).toBe(true);
    expect(role.nameI18n).toEqual({ en: 'Admin', ar: 'مدير' });
  });

  it('isDeletable returns false for system roles', () => {
    const owner = Role.fromPersistence(makeOwnerRoleData());
    expect(owner.isDeletable).toBe(false);

    const custom = Role.fromPersistence(makeCustomRoleData());
    expect(custom.isDeletable).toBe(true);
  });
});

describe('Role.update()', () => {
  it('updates nameI18n for a custom role', () => {
    const role = Role.create(makeCustomRoleData());
    role.update({ nameI18n: { en: 'Senior Sales Manager' } }, 'user-2');

    expect(role.nameI18n).toEqual({ en: 'Senior Sales Manager' });
  });

  it('updates description for a custom role', () => {
    const role = Role.create(makeCustomRoleData());
    role.update({ description: 'New description' }, 'user-2');

    expect(role.description).toBe('New description');
  });

  it('sets description to null when explicitly passed', () => {
    const role = Role.create(makeCustomRoleData({ description: 'Old desc' }));
    role.update({ description: null }, 'user-2');

    expect(role.description).toBeNull();
  });

  it('throws SYSTEM_ROLE_IMMUTABLE when renaming a system role', () => {
    const role = Role.create(makeOwnerRoleData());

    expectRoleError(() => {
      role.update({ nameI18n: { en: 'Super Owner' } }, 'user-2');
    }, SYSTEM_ROLE_IMMUTABLE);
  });

  it('allows description update on system roles', () => {
    const role = Role.create(makeAdminRoleData());

    // Should not throw
    role.update({ description: 'Updated admin description' }, 'user-2');
    expect(role.description).toBe('Updated admin description');
  });

  it('does not throw when nameI18n is not provided for system roles', () => {
    const role = Role.create(makeOwnerRoleData());

    expect(() => {
      role.update({ description: 'Just updating description' }, 'user-2');
    }).not.toThrow();
  });

  it('does not throw when nameI18n is undefined for system roles', () => {
    const role = Role.create(makeAdminRoleData());

    expect(() => {
      role.update({}, 'user-2');
    }).not.toThrow();
  });

  it('does not throw when nameI18n is not provided for system roles (only description)', () => {
    const role = Role.create(makeOwnerRoleData());

    expect(() => {
      role.update({ description: 'Just updating description' }, 'user-2');
    }).not.toThrow();
  });
});

describe('Role.delete()', () => {
  it('soft-deletes a custom role', () => {
    const role = Role.create(makeCustomRoleData());
    expect(role.deletedAt).toBeNull();

    role.delete(false, 'user-2');

    expect(role.deletedAt).toBeInstanceOf(Date);
  });

  it('throws SYSTEM_ROLE_IMMUTABLE when deleting a system role', () => {
    const role = Role.create(makeOwnerRoleData());

    expectRoleError(() => {
      role.delete(false, 'user-2');
    }, SYSTEM_ROLE_IMMUTABLE);
  });

  it('throws LAST_OWNER_ROLE when deleting the last owner role', () => {
    const role = Role.create(makeCustomRoleData());

    expectRoleError(() => {
      role.delete(true, 'user-2');
    }, LAST_OWNER_ROLE);
  });

  it('LAST_OWNER_ROLE takes priority for custom roles with isLastOwnerRole=true', () => {
    const role = Role.create(makeCustomRoleData());

    expectRoleError(() => {
      role.delete(true, 'user-2');
    }, LAST_OWNER_ROLE);
  });
});

describe('AUTHZ-4: Custom roles cannot include platform-admin permissions', () => {
  it('allows custom permissions that are not platform-admin', () => {
    expect(() => {
      Role.validateCustomPermissions(['crm:contact:read', 'inventory:stock:adjust', 'pos:sale:create']);
    }).not.toThrow();
  });

  it('allows an empty permissions array', () => {
    expect(() => {
      Role.validateCustomPermissions([]);
    }).not.toThrow();
  });

  it('rejects a single platform-admin permission', () => {
    expectRoleError(
      () => Role.validateCustomPermissions(['platform:billing:manage']),
      CUSTOM_ROLE_PLATFORM_PERMISSION_DENIED,
    );
  });

  it('rejects multiple platform-admin permissions', () => {
    expectRoleError(
      () =>
        Role.validateCustomPermissions([
          'platform:billing:manage',
          'platform:organization:delete',
          'platform:roles:manage',
        ]),
      CUSTOM_ROLE_PLATFORM_PERMISSION_DENIED,
    );
  });

  it('rejects ALL platform-admin permissions when passed together', () => {
    expectRoleError(
      () => Role.validateCustomPermissions([...PLATFORM_PERMISSIONS]),
      CUSTOM_ROLE_PLATFORM_PERMISSION_DENIED,
    );
  });

  it('rejects when a module permission is mixed with a platform permission', () => {
    expectRoleError(
      () => Role.validateCustomPermissions(['crm:contact:read', 'platform:settings:manage', 'inventory:product:read']),
      CUSTOM_ROLE_PLATFORM_PERMISSION_DENIED,
    );
  });

  it('does not reject permissions that only partially match the platform prefix', () => {
    expect(() => {
      Role.validateCustomPermissions(['platform:data:read', 'platform:data:write']);
    }).not.toThrow();
  });

  it('rejects each individual platform permission', () => {
    for (const perm of PLATFORM_PERMISSIONS) {
      expectRoleError(() => Role.validateCustomPermissions([perm]), CUSTOM_ROLE_PLATFORM_PERMISSION_DENIED);
    }
  });
});

describe('AUTHZ-2: Ownership transfer domain logic', () => {
  it('isOwnerRole is true only for the owner key', () => {
    const owner = Role.create(makeOwnerRoleData());
    expect(owner.isOwnerRole).toBe(true);

    // All other system roles
    for (const key of Object.values(SYSTEM_ROLES)) {
      if (key === 'owner') continue;
      const role = Role.create(makeOwnerRoleData({ key, isSystem: true }));
      expect(role.isOwnerRole).toBe(false);
    }

    // Custom role
    const custom = Role.create(makeCustomRoleData());
    expect(custom.isOwnerRole).toBe(false);
  });

  it('organizationId is consistent across role instances', () => {
    const role1 = Role.create(makeOwnerRoleData({ organizationId: 'org-1' }));
    const role2 = Role.create(makeOwnerRoleData({ organizationId: 'org-2' }));

    expect(role1.organizationId).toBe('org-1');
    expect(role2.organizationId).toBe('org-2');
  });
});

describe('Role.toJSON()', () => {
  it('returns a copy of the role data', () => {
    const data = makeCustomRoleData();
    const role = Role.create(data);
    const json = role.toJSON();

    expect(json.id).toBe(data.id);
    expect(json.key).toBe(data.key);
    expect(json.nameI18n).toEqual(data.nameI18n);
    expect(json.isSystem).toBe(false);
  });
});

describe('RoleError', () => {
  it('extends DomainError with a code', () => {
    const error = new RoleError('TEST_ERROR', 'Test message');

    expect(error).toBeInstanceOf(RoleError);
    expect(error.code).toBe('TEST_ERROR');
    expect(error.message).toBe('Test message');
    expect(error.name).toBe('RoleError');
  });
});
