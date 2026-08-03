import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { REQUIRED_MODULE_KEY } from '../../../core/authorization/module.decorator.js';
import { REQUIRED_PERMISSIONS_KEY } from '../../../core/authorization/permission.decorator.js';
import { AUDIT_METADATA_KEY } from '../../../core/audit/audit.interceptor.js';
import { ActivitiesController } from '../api/activities.controller.js';
import { ContactsController } from '../api/contacts.controller.js';
import { DealsController } from '../api/deals.controller.js';

/**
 * Controllers only delegate to use cases — the handlers are never invoked
 * here, so collaborator slots are null-safe (mirrors the platform
 * `organizations.controller.spec.ts` metadata pattern).
 */

function makeContactsController(): ContactsController {
  return new ContactsController(null as never, null as never, null as never);
}

function makeDealsController(): DealsController {
  return new DealsController(null as never, null as never, null as never, null as never, null as never);
}

function makeActivitiesController(): ActivitiesController {
  return new ActivitiesController(null as never, null as never, null as never);
}

const reflector = new Reflector();

function permissionsFor(method: (...args: never[]) => unknown): string[] | undefined {
  return reflector.get(REQUIRED_PERMISSIONS_KEY, method);
}

function moduleFor(target: object): string | undefined {
  return reflector.get(REQUIRED_MODULE_KEY, target as new (...args: never[]) => unknown);
}

function auditFor(method: (...args: never[]) => unknown): unknown {
  return reflector.get(AUDIT_METADATA_KEY, method);
}

describe('CRM controllers — entitlement metadata (AUTHZ-6)', () => {
  it('AUTHZ-6: every CRM controller class requires the crm module entitlement', () => {
    expect(moduleFor(ContactsController)).toBe('crm');
    expect(moduleFor(DealsController)).toBe('crm');
    expect(moduleFor(ActivitiesController)).toBe('crm');
  });
});

describe('ContactsController — permission metadata', () => {
  it('POST /v1/crm/contacts requires crm:contact:write and is audited', () => {
    const c = makeContactsController();
    expect(permissionsFor(c.create as (...args: never[]) => unknown)).toEqual(['crm:contact:write']);
    expect(auditFor(c.create as (...args: never[]) => unknown)).toMatchObject({ entityType: 'contact' });
  });

  it('PATCH /v1/crm/contacts/:id requires crm:contact:write and is audited', () => {
    const c = makeContactsController();
    expect(permissionsFor(c.update as (...args: never[]) => unknown)).toEqual(['crm:contact:write']);
    expect(auditFor(c.update as (...args: never[]) => unknown)).toMatchObject({ entityType: 'contact' });
  });

  it('POST /v1/crm/contacts/merge requires crm:contact:write (CRM-12) and is audited', () => {
    const c = makeContactsController();
    expect(permissionsFor(c.merge as (...args: never[]) => unknown)).toEqual(['crm:contact:write']);
    expect(auditFor(c.merge as (...args: never[]) => unknown)).toBeDefined();
  });
});

describe('DealsController — permission metadata', () => {
  it('every deal mutation requires crm:deal:write and is audited', () => {
    const d = makeDealsController();
    for (const method of [
      d.create as (...args: never[]) => unknown,
      d.moveStage as (...args: never[]) => unknown,
      d.close as (...args: never[]) => unknown,
      d.reopen as (...args: never[]) => unknown,
    ]) {
      expect(permissionsFor(method)).toEqual(['crm:deal:write']);
      expect(auditFor(method)).toBeDefined();
    }
  });
});

describe('ActivitiesController — permission metadata', () => {
  it('every activity mutation requires crm:activity:write and is audited', () => {
    const a = makeActivitiesController();
    for (const method of [a.create as (...args: never[]) => unknown, a.complete as (...args: never[]) => unknown]) {
      expect(permissionsFor(method)).toEqual(['crm:activity:write']);
      expect(auditFor(method)).toBeDefined();
    }
  });
});
