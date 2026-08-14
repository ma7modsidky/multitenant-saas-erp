import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PLATFORM_ADMIN_KEY } from '../platform-admin.decorator.js';
import { PlatformAdminGuard } from '../platform-admin.guard.js';

function makeContext(user?: { sub?: string; isPlatformAdmin?: boolean }): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('PlatformAdminGuard (PLT-2)', () => {
  let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> };
  let guard: PlatformAdminGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
    guard = new PlatformAdminGuard(reflector as unknown as Reflector);
  });

  it('PLT-2: is a no-op for routes without @RequiresPlatformAdmin', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    expect(guard.canActivate(makeContext({ sub: 'user-1', isPlatformAdmin: false }))).toBe(true);
  });

  it('PLT-2: lets an unauthenticated request pass — JwtAuthGuard rejects it upstream', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it('PLT-2: rejects an authenticated non-admin with 403 PLATFORM_ADMIN_REQUIRED', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(() => guard.canActivate(makeContext({ sub: 'user-1', isPlatformAdmin: false }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(makeContext({ sub: 'user-1', isPlatformAdmin: false }))).toThrow(
      'PLATFORM_ADMIN_REQUIRED',
    );
  });

  it('PLT-2: admits a user whose token carries isPlatformAdmin = true', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(guard.canActivate(makeContext({ sub: 'admin-1', isPlatformAdmin: true }))).toBe(true);
  });

  it('PLT-2: reads the metadata key used by the decorator', () => {
    guard.canActivate(makeContext({ sub: 'admin-1', isPlatformAdmin: true }));
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(PLATFORM_ADMIN_KEY, expect.any(Array));
  });
});
