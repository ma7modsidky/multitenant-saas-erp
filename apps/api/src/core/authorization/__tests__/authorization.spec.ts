import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, beforeEach } from 'vitest';

import { InMemoryEntitlementStore } from '../../entitlements/entitlement-store.js';
import { EntitlementService } from '../../entitlements/entitlement.service.js';
import { EntitlementGuard } from '../entitlement.guard.js';
import { JwtAuthGuard } from '../jwtauth.guard.js';
import { PermissionGuard } from '../permission.guard.js';
import { RequiresModule, REQUIRED_MODULE_KEY } from '../module.decorator.js';
import { RequiresPermission, REQUIRED_PERMISSIONS_KEY } from '../permission.decorator.js';

// ─── Test helpers ──────────────────────────────────────────────────────────

/** Standard authenticated user as attached by JwtAuthGuard */
const adminUser = {
  sub: 'user-1',
  organizationId: 'org-1',
  roles: ['ADMIN'],
  permissions: ['inventory:product:read', 'inventory:product:write', 'inventory:stock:adjust'],
};

const systemUser = {
  sub: 'system',
  organizationId: undefined,
  roles: [],
  permissions: [],
};

const posUser = {
  sub: 'user-2',
  organizationId: 'org-1',
  roles: ['MEMBER'],
  permissions: ['pos:sale:create', 'pos:shift:open'],
};

/**
 * Helper to create a mock execution context with a request.user.
 * Returns a context compatible with all three guard types.
 */
function createMockContext(
  handler: (...args: unknown[]) => unknown,
  mockUser: Record<string, unknown> | null,
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: mockUser,
      }),
    }),
    getHandler: () => handler,
    getClass: () => Object.getPrototypeOf(handler).constructor,
  } as unknown as Parameters<EntitlementGuard['canActivate']>[0];
}

/**
 * Create an EntitlementGuard with a pre-seeded entitlement store.
 */
async function createEntitlementGuard(seeds: Array<{
  orgId: string;
  moduleKey: string;
  state: string;
}>): Promise<EntitlementGuard> {
  const store = new InMemoryEntitlementStore();
  for (const seed of seeds) {
    await store.upsert({
      moduleKey: seed.moduleKey,
      organizationId: seed.orgId,
      state: seed.state as 'active' | 'trialing' | 'past_due' | 'expired' | 'available' | 'suspended' | 'disabled',
      trialStartedAt: null,
      trialEndsAt: null,
      activatedAt: seed.state === 'active' ? '2026-01-01T00:00:00Z' : null,
      disabledAt: seed.state === 'disabled' ? '2026-03-01T00:00:00Z' : null,
      purgeAfter: null,
    });
  }
  const service = new EntitlementService(store as never);
  return new EntitlementGuard(new Reflector(), service as never);
}

// ─── @RequiresModule decorator ─────────────────────────────────────────────

describe('@RequiresModule', () => {
  it('sets the required module metadata on a method', () => {
    class TestController {
      @RequiresModule('inventory')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const metadata = Reflect.getMetadata(REQUIRED_MODULE_KEY, controller.handle);
    expect(metadata).toBe('inventory');
  });

  it('sets the required module metadata on a class', () => {
    @RequiresModule('inventory')
    class TestController {
      handle(): void {
        /* noop */
      }
    }

    const metadata = Reflect.getMetadata(REQUIRED_MODULE_KEY, TestController);
    expect(metadata).toBe('inventory');
  });

  it('does not set metadata on an undecorated method', () => {
    class TestController {
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const metadata = Reflect.getMetadata(REQUIRED_MODULE_KEY, controller.handle);
    expect(metadata).toBeUndefined();
  });
});

// ─── @RequiresPermission decorator ─────────────────────────────────────────

describe('@RequiresPermission', () => {
  it('sets required permission metadata on a method', () => {
    class TestController {
      @RequiresPermission('inventory:product:read')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const metadata = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.handle);
    expect(metadata).toEqual(['inventory:product:read']);
  });

  it('supports multiple permissions', () => {
    class TestController {
      @RequiresPermission('inventory:product:read', 'inventory:product:write')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const metadata = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.handle);
    expect(metadata).toEqual(['inventory:product:read', 'inventory:product:write']);
  });

  it('does not set metadata on an undecorated method', () => {
    class TestController {
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const metadata = Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.handle);
    expect(metadata).toBeUndefined();
  });
});

// ─── JwtAuthGuard ──────────────────────────────────────────────────────────

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard(new Reflector());
  });

  it('is defined', () => {
    expect(guard).toBeDefined();
  });
});

// ─── EntitlementGuard ─────────────────────────────────────────────────────

describe('EntitlementGuard', () => {
  it('AUTHZ-6: allows access when no module is required', async () => {
    const guard = await createEntitlementGuard([]);

    class TestController {
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('AUTHZ-6: allows access when the org is entitled with active state', async () => {
    const guard = await createEntitlementGuard([
      { orgId: 'org-1', moduleKey: 'inventory', state: 'active' },
    ]);

    class TestController {
      @RequiresModule('inventory')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('AUTHZ-6: allows access when the org is entitled with trialing state', async () => {
    const guard = await createEntitlementGuard([
      { orgId: 'org-1', moduleKey: 'inventory', state: 'trialing' },
    ]);

    class TestController {
      @RequiresModule('inventory')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('BILL-6: allows access when state is past_due (dunning window)', async () => {
    const guard = await createEntitlementGuard([
      { orgId: 'org-1', moduleKey: 'inventory', state: 'past_due' },
    ]);

    class TestController {
      @RequiresModule('inventory')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('BILL-3: allows access when state is expired (grace period)', async () => {
    const guard = await createEntitlementGuard([
      { orgId: 'org-1', moduleKey: 'inventory', state: 'expired' },
    ]);

    class TestController {
      @RequiresModule('inventory')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('AUTHZ-6: denies access when the org is NOT entitled to the module', async () => {
    const guard = await createEntitlementGuard([
      { orgId: 'org-1', moduleKey: 'inventory', state: 'active' },
    ]);

    class TestController {
      @RequiresModule('pos')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('MODULE_NOT_ENTITLED');
  });

  it('AUTHZ-6: denies access when module is disabled (BILL-7)', async () => {
    const guard = await createEntitlementGuard([
      { orgId: 'org-1', moduleKey: 'inventory', state: 'disabled' },
    ]);

    class TestController {
      @RequiresModule('inventory')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('denies access when module is suspended', async () => {
    const guard = await createEntitlementGuard([
      { orgId: 'org-1', moduleKey: 'inventory', state: 'suspended' },
    ]);

    class TestController {
      @RequiresModule('inventory')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('denies access when no entitlement record exists (module never enabled)', async () => {
    const guard = await createEntitlementGuard([]);

    class TestController {
      @RequiresModule('inventory')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('AUTHZ-6: denies access for system users without org context', async () => {
    const guard = await createEntitlementGuard([]);

    class TestController {
      @RequiresModule('inventory')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, systemUser);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('reads class-level @RequiresModule metadata', async () => {
    const guard = await createEntitlementGuard([
      { orgId: 'org-1', moduleKey: 'inventory', state: 'active' },
    ]);

    @RequiresModule('inventory')
    class TestController {
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('is isolated per module — org entitled to inventory but not pos', async () => {
    const guard = await createEntitlementGuard([
      { orgId: 'org-1', moduleKey: 'inventory', state: 'active' },
    ]);

    class PosController {
      @RequiresModule('pos')
      handle(): void {
        /* noop */
      }
    }

    const controller = new PosController();
    const ctx = createMockContext(controller.handle, posUser);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('denies access when module is available (not yet enabled)', async () => {
    const guard = await createEntitlementGuard([
      { orgId: 'org-1', moduleKey: 'inventory', state: 'available' },
    ]);

    class TestController {
      @RequiresModule('inventory')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});

// ─── PermissionGuard ───────────────────────────────────────────────────────

describe('PermissionGuard', () => {
  let guard: PermissionGuard;

  beforeEach(() => {
    guard = new PermissionGuard(new Reflector());
  });

  it('AUTHZ-5: allows access when no permission is required', () => {
    class TestController {
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('AUTHZ-5: allows access when the user has all required permissions', () => {
    class TestController {
      @RequiresPermission('inventory:product:read')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('AUTHZ-5: allows access when the user has multiple required permissions', () => {
    class TestController {
      @RequiresPermission('inventory:product:read', 'inventory:product:write')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('AUTHZ-5: denies access when the user lacks a required permission', () => {
    class TestController {
      @RequiresPermission('inventory:product:delete')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('AUTHZ-5: denies access when the user lacks one of multiple required permissions', () => {
    class TestController {
      @RequiresPermission('inventory:product:read', 'inventory:product:delete')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('denies access for a completely unauthorized user', () => {
    class TestController {
      @RequiresPermission('inventory:product:read')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, systemUser);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('AUTHZ-5: handles manage permission correctly', () => {
    const managerUser = {
      ...adminUser,
      permissions: ['crm:contact:manage'],
    };

    class TestController {
      @RequiresPermission('crm:contact:read')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, managerUser);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects invalid permission format in @RequiresPermission', () => {
    class TestController {
      @RequiresPermission('invalid_format')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, adminUser);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows access when no user is present (handled upstream by JwtAuthGuard)', () => {
    class TestController {
      @RequiresPermission('inventory:product:read')
      handle(): void {
        /* noop */
      }
    }

    const controller = new TestController();
    const ctx = createMockContext(controller.handle, null);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
