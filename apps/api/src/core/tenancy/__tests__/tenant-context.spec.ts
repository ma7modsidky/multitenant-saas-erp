import { describe, expect, it } from 'vitest';

import { PublicRoute, SystemContext, TENANCY_METADATA } from '../system-context.decorator.js';
import { TenantContext } from '../tenant-context.js';
import { withoutTenantContext } from '../without-tenant-context.js';

// ─── Test data ────────────────────────────────────────────────────────────

const defaultContext = {
  userId: 'user-1',
  sessionId: 'session-1',
  organizationId: 'org-1',
  roles: ['ADMIN', 'MANAGER'],
  permissions: ['inventory:product:read', 'inventory:stock:adjust'],
  locale: 'en',
};

const systemContext = {
  userId: 'system',
  sessionId: undefined,
  organizationId: undefined,
  roles: [],
  permissions: [],
  locale: 'en',
};

// ─── TenantContext tests ──────────────────────────────────────────────────

describe('TenantContext', () => {
  it('provides tenant data within a context scope', async () => {
    const result = await TenantContext.run(defaultContext, async () => {
      return TenantContext.getCurrent();
    });

    expect(result).toEqual(defaultContext);
  });

  it('returns undefined outside a context scope', () => {
    expect(TenantContext.getCurrent()).toBeUndefined();
  });

  it('isolates nested context scopes', async () => {
    const outer = await TenantContext.run({ ...defaultContext, userId: 'outer' }, async () => {
      const inner = await TenantContext.run({ ...defaultContext, userId: 'inner' }, async () =>
        TenantContext.getCurrent(),
      );
      return { outerCtx: TenantContext.getCurrent(), innerCtx: inner };
    });

    expect(outer.outerCtx?.userId).toBe('outer');
    expect(outer.innerCtx?.userId).toBe('inner');
  });

  // ─── Getters ──────────────────────────────────────────────────────────

  it('getOrganizationId() returns the org id', async () => {
    await TenantContext.run(defaultContext, async () => {
      expect(TenantContext.getOrganizationId()).toBe('org-1');
    });
  });

  it('getOrganizationId() returns undefined outside a context scope', () => {
    expect(TenantContext.getOrganizationId()).toBeUndefined();
  });

  it('getOrganizationId() returns undefined for system context', async () => {
    await TenantContext.run(systemContext, async () => {
      expect(TenantContext.getOrganizationId()).toBeUndefined();
    });
  });

  it('requireOrganizationId() returns the org id', async () => {
    await TenantContext.run(defaultContext, async () => {
      expect(TenantContext.requireOrganizationId()).toBe('org-1');
    });
  });

  it('requireOrganizationId() throws outside a context scope', () => {
    expect(() => TenantContext.requireOrganizationId()).toThrow('No tenant context available');
  });

  it('requireOrganizationId() throws for system context without orgId', async () => {
    await TenantContext.run(systemContext, async () => {
      expect(() => TenantContext.requireOrganizationId()).toThrow('No organization ID in tenant context');
    });
  });

  it('getUserId() returns the user id', async () => {
    await TenantContext.run(defaultContext, async () => {
      expect(TenantContext.getUserId()).toBe('user-1');
    });
  });

  it('getUserId() returns undefined outside a context scope', () => {
    expect(TenantContext.getUserId()).toBeUndefined();
  });

  it('requireUserId() throws outside a context scope', () => {
    expect(() => TenantContext.requireUserId()).toThrow('No tenant context available');
  });

  // ─── Roles, permissions, locale ───────────────────────────────────────

  it('getRoles() returns the user roles', async () => {
    await TenantContext.run(defaultContext, async () => {
      expect(TenantContext.getRoles()).toEqual(['ADMIN', 'MANAGER']);
    });
  });

  it('getRoles() returns empty array outside context', () => {
    expect(TenantContext.getRoles()).toEqual([]);
  });

  it('getPermissions() returns the user permissions', async () => {
    await TenantContext.run(defaultContext, async () => {
      expect(TenantContext.getPermissions()).toEqual(['inventory:product:read', 'inventory:stock:adjust']);
    });
  });

  it('getPermissions() returns empty array outside context', () => {
    expect(TenantContext.getPermissions()).toEqual([]);
  });

  it('getLocale() returns the request locale', async () => {
    await TenantContext.run(defaultContext, async () => {
      expect(TenantContext.getLocale()).toBe('en');
    });
  });

  it('getLocale() returns "en" as fallback outside context', () => {
    expect(TenantContext.getLocale()).toBe('en');
  });

  it('getLocale() returns locale from system context', async () => {
    await TenantContext.run({ ...systemContext, locale: 'ar' }, async () => {
      expect(TenantContext.getLocale()).toBe('ar');
    });
  });

  it('getSessionId() returns the session id (AUTH-5)', async () => {
    await TenantContext.run(defaultContext, async () => {
      expect(TenantContext.getSessionId()).toBe('session-1');
    });
  });

  it('getSessionId() returns undefined outside context', () => {
    expect(TenantContext.getSessionId()).toBeUndefined();
  });

  it('getSessionId() returns undefined for system context', async () => {
    await TenantContext.run(systemContext, async () => {
      expect(TenantContext.getSessionId()).toBeUndefined();
    });
  });
});

// ─── System context decorators ───────────────────────────────────────────

describe('@PublicRoute and @SystemContext decorators', () => {
  class TestController {
    @PublicRoute()
    handlePublic(): void {
      /* noop */
    }

    @SystemContext()
    handleSystem(): void {
      /* noop */
    }

    handleNormal(): void {
      /* noop */
    }
  }

  it('@PublicRoute sets IS_PUBLIC metadata', () => {
    const controller = new TestController();
    const isPublic = Reflect.getMetadata(TENANCY_METADATA.IS_PUBLIC, controller.handlePublic);
    expect(isPublic).toBe(true);
  });

  it('@SystemContext sets IS_SYSTEM_CONTEXT metadata', () => {
    const controller = new TestController();
    const isSystem = Reflect.getMetadata(TENANCY_METADATA.IS_SYSTEM_CONTEXT, controller.handleSystem);
    expect(isSystem).toBe(true);
  });

  it('normal routes have no tenancy metadata', () => {
    const controller = new TestController();
    const isPublic = Reflect.getMetadata(TENANCY_METADATA.IS_PUBLIC, controller.handleNormal);
    const isSystem = Reflect.getMetadata(TENANCY_METADATA.IS_SYSTEM_CONTEXT, controller.handleNormal);
    expect(isPublic).toBeUndefined();
    expect(isSystem).toBeUndefined();
  });
});

// ─── withoutTenantContext helper ──────────────────────────────────────────

describe('withoutTenantContext', () => {
  it('runs the callback without tenant context', async () => {
    const result = await TenantContext.run(defaultContext, async () => {
      // Inside tenant context — confirm it's set
      expect(TenantContext.getCurrent()).toBeDefined();

      // Call withoutTenantContext to escape
      return withoutTenantContext(async () => {
        return TenantContext.getCurrent();
      });
    });

    // The inner callback should have no tenant context
    expect(result).toBeUndefined();
  });

  it('returns the callback result', async () => {
    const result = await withoutTenantContext(async () => 42);
    expect(result).toBe(42);
  });

  it('propagates errors from the callback', async () => {
    await expect(
      withoutTenantContext(async () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');
  });

  it('TenantContext.getOrganizationId() returns undefined inside withoutTenantContext', async () => {
    const result = await withoutTenantContext(async () => {
      return TenantContext.getOrganizationId();
    });
    expect(result).toBeUndefined();
  });

  it('TenantContext.requireOrganizationId() throws inside withoutTenantContext', async () => {
    await expect(
      withoutTenantContext(async () => {
        TenantContext.requireOrganizationId();
      }),
    ).rejects.toThrow('No tenant context available');
  });
});
