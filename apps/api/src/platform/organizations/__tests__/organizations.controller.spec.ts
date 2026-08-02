import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { REQUIRED_PERMISSIONS_KEY } from '../../../core/authorization/permission.decorator.js';
import { TenantContext, type TenantContextData } from '../../../core/tenancy/tenant-context.js';
import { OrganizationsController } from '../api/organizations.controller.js';

/**
 * The controller's handlers are only inspected for route metadata here, so
 * the use-case collaborators are never invoked — nulls are safe.
 */
function createController(): OrganizationsController {
  return new OrganizationsController(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
}

const reflector = new Reflector();

function permissionsFor(method: (...args: never[]) => unknown): string[] | undefined {
  return reflector.get(REQUIRED_PERMISSIONS_KEY, method);
}

describe('OrganizationsController — route permission metadata (AUTHZ-5)', () => {
  it('AUTHZ-5/BUSINESS_RULES §3: PATCH /v1/organizations/:id (org profile) requires platform:settings:manage', () => {
    // Regression: this route was previously UNGUARDED — any member (even a
    // VIEWER) could rename the org and change its currency because only the
    // /settings route carried the permission. The web form calls this endpoint
    // for name/currency, so the change silently persisted while the UI showed
    // a generic error from the /settings call.
    expect(permissionsFor(createController().update as (...args: never[]) => unknown)).toEqual([
      'platform:settings:manage',
    ]);
  });

  it('AUTHZ-5/BUSINESS_RULES §3: PATCH /v1/organizations/:id/settings requires platform:settings:manage', () => {
    expect(permissionsFor(createController().updateSettings as (...args: never[]) => unknown)).toEqual([
      'platform:settings:manage',
    ]);
  });

  it('AUTHZ-5/BUSINESS_RULES §3: DELETE /v1/organizations/:id requires platform:organization:delete', () => {
    expect(permissionsFor(createController().delete as (...args: never[]) => unknown)).toEqual([
      'platform:organization:delete',
    ]);
  });

  it('AUTHZ-5/BUSINESS_RULES §3: POST /v1/organizations/:id/cancel-deletion requires platform:organization:delete', () => {
    expect(permissionsFor(createController().cancelDeletion as (...args: never[]) => unknown)).toEqual([
      'platform:organization:delete',
    ]);
  });

  it('AUTHZ-5: read routes (GET /:id, GET /me, GET /:id/settings) are not permission-gated (any member may view)', () => {
    const controller = createController();
    expect(permissionsFor(controller.getById as (...args: never[]) => unknown)).toBeUndefined();
    expect(permissionsFor(controller.getCurrent as (...args: never[]) => unknown)).toBeUndefined();
    expect(permissionsFor(controller.getSettings as (...args: never[]) => unknown)).toBeUndefined();
  });

  it('AUTHZ-5: POST /v1/organizations (create) is not permission-gated (any authenticated user may onboard)', () => {
    expect(permissionsFor(createController().create as (...args: never[]) => unknown)).toBeUndefined();
  });
});

// ─── TEN-2 ownership binding (assertSessionOrg) ────────────────────────────

const SESSION_ORG = 'org-1';

const sessionContext: TenantContextData = {
  userId: 'user-1',
  sessionId: undefined,
  organizationId: SESSION_ORG,
  roles: ['owner'],
  permissions: ['platform:settings:manage', 'platform:organization:delete'],
  locale: 'en',
};

interface MockCollaborators {
  getOrg: ReturnType<typeof vi.fn>;
  updateOrg: ReturnType<typeof vi.fn>;
  deleteOrg: ReturnType<typeof vi.fn>;
  cancelDeletion: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
}

/**
 * Controller wired to mocked use cases so handlers can be invoked end-to-end
 * (metadata-only tests pass `null as never`; these tests exercise behaviour).
 */
function createMockedController(): { controller: OrganizationsController } & MockCollaborators {
  // Must satisfy organizationToResponse() shape (createdAt/updatedAt are
  // serialized via toISOString, deletionScheduledAt via ?.toISOString).
  const orgJSON = {
    id: SESSION_ORG,
    name: 'Acme Inc',
    slug: 'acme',
    countryCode: 'US',
    timezone: 'UTC',
    baseCurrency: 'USD',
    defaultLocale: 'en',
    status: 'active',
    deletionScheduledAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const getOrg = vi.fn().mockResolvedValue({
    organization: { toJSON: () => orgJSON },
    settings: undefined,
  });
  const updateOrg = vi.fn().mockResolvedValue({ toJSON: () => orgJSON });
  const deleteOrg = vi.fn().mockResolvedValue({ deletionScheduledAt: new Date(), message: '' });
  const cancelDeletion = vi.fn().mockResolvedValue({ toJSON: () => orgJSON });
  // Must satisfy settingsToResponse() shape (locale, timezone, baseCurrency,
  // receiptFooter, and createdAt/updatedAt serialized via toISOString).
  const settingsJSON = {
    id: 'set-1',
    organizationId: SESSION_ORG,
    locale: 'en',
    timezone: 'UTC',
    baseCurrency: 'USD',
    numberPreferences: {},
    datePreferences: {},
    receiptFooter: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const updateSettings = vi.fn().mockResolvedValue({ toJSON: () => settingsJSON });

  // The controller calls `useCase.execute(...)` on each collaborator, so the
  // mocks must be shaped as `{ execute: vi.fn() }` — a bare vi.fn() would
  // fail with "execute is not a function".
  const controller = new OrganizationsController(
    { execute: vi.fn() } as never, // createOrg — unused by these routes
    { execute: getOrg } as never,
    { execute: updateOrg } as never,
    { execute: deleteOrg } as never,
    { execute: cancelDeletion } as never,
    { execute: updateSettings } as never,
  );

  return { controller, getOrg, updateOrg, deleteOrg, cancelDeletion, updateSettings };
}

describe('OrganizationsController — assertSessionOrg (TEN-2: session org authoritative)', () => {
  it('TEN-2: rejects a mismatched :id path param with 404 ORG_NOT_FOUND on every org-scoped route', async () => {
    const { controller } = createMockedController();

    await TenantContext.run(sessionContext, async () => {
      // core_organizations is a GLOBAL (non-RLS) table, so nothing below the
      // controller filters by org — the :id binding is the only guard against
      // an OWNER of org A mutating org B's profile. Each route must fail
      // closed (404, as if the org did not exist) when :id ≠ session org.
      const routes: Array<() => Promise<unknown>> = [
        () => controller.getById('org-999'),
        () => controller.update('org-999', {}),
        () => controller.delete('org-999'),
        () => controller.cancelDeletion('org-999'),
        () => controller.getSettings('org-999'),
        () => controller.updateSettings('org-999', {}),
      ];

      for (const route of routes) {
        // NotFoundError carries code 'NOT_FOUND' and message 'ORG_NOT_FOUND'.
        await expect(route()).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'ORG_NOT_FOUND' });
      }
    });
  });

  it('TEN-2: a matching :id passes the SESSION org to the use case, never the raw param', async () => {
    const { controller, getOrg, updateOrg, deleteOrg, cancelDeletion, updateSettings } = createMockedController();

    await TenantContext.run(sessionContext, async () => {
      await controller.getById(SESSION_ORG);
      expect(getOrg).toHaveBeenCalledWith({ organizationId: SESSION_ORG });

      await controller.update(SESSION_ORG, { name: 'Renamed' });
      expect(updateOrg).toHaveBeenCalledWith(expect.objectContaining({ organizationId: SESSION_ORG, name: 'Renamed' }));

      await controller.delete(SESSION_ORG);
      expect(deleteOrg).toHaveBeenCalledWith({ organizationId: SESSION_ORG });

      await controller.cancelDeletion(SESSION_ORG);
      expect(cancelDeletion).toHaveBeenCalledWith({ organizationId: SESSION_ORG });

      await controller.getSettings(SESSION_ORG);
      expect(getOrg).toHaveBeenCalledWith({ organizationId: SESSION_ORG });

      await controller.updateSettings(SESSION_ORG, { baseCurrency: 'EUR' });
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: SESSION_ORG, baseCurrency: 'EUR' }),
      );
    });
  });

  it('TEN-3: a request with NO tenant context fails closed (never reaches a use case)', async () => {
    const { controller, updateOrg } = createMockedController();

    // runWithCleanContext simulates a system-context request (no tenant context
    // at all): requireOrganizationId() throws its "no tenant context" branch —
    // the message says TENANT context (not 'organization context', which only
    // fires when a context exists but has no org id).
    await expect(TenantContext.runWithCleanContext(() => controller.update('org-1', {}))).rejects.toThrow(
      /requires an active tenant context/i,
    );
    expect(updateOrg).not.toHaveBeenCalled();
  });
});
