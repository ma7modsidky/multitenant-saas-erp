import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { REQUIRED_MODULE_KEY } from '../../../core/authorization/module.decorator.js';
import { REQUIRED_PERMISSIONS_KEY } from '../../../core/authorization/permission.decorator.js';
import { AUDIT_METADATA_KEY } from '../../../core/audit/audit.interceptor.js';
import { ActivitiesController } from '../api/activities.controller.js';
import { CompaniesController } from '../api/companies.controller.js';
import { ContactsController } from '../api/contacts.controller.js';
import { updateActivitySchema } from '../api/dto/crm.dto.js';
import { DealsController } from '../api/deals.controller.js';
import { PipelinesController } from '../api/pipelines.controller.js';

/**
 * Controllers only delegate to use cases — the handlers are never invoked
 * here, so collaborator slots are null-safe (mirrors the platform
 * `organizations.controller.spec.ts` metadata pattern).
 */

function makeContactsController(): ContactsController {
  return new ContactsController(null as never, null as never, null as never, null as never, null as never);
}

function makeCompaniesController(): CompaniesController {
  return new CompaniesController(null as never, null as never, null as never, null as never);
}

function makeDealsController(): DealsController {
  return new DealsController(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
}

function makeActivitiesController(): ActivitiesController {
  return new ActivitiesController(
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
    expect(moduleFor(CompaniesController)).toBe('crm');
    expect(moduleFor(PipelinesController)).toBe('crm');
  });
});

describe('ContactsController — permission metadata', () => {
  it('GET /v1/crm/contacts requires crm:contact:read', () => {
    expect(permissionsFor(makeContactsController().list as (...args: never[]) => unknown)).toEqual([
      'crm:contact:read',
    ]);
  });
  it('GET /v1/crm/contacts/:id requires crm:contact:read (detail)', () => {
    expect(permissionsFor(makeContactsController().getById as (...args: never[]) => unknown)).toEqual([
      'crm:contact:read',
    ]);
  });
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

describe('DealsController — list validation', () => {
  // The use-case slot is null in these controllers — a 400 thrown by the
  // param validation must fire BEFORE the use case is reached.
  it('rejects a malformed fromDate with 400 before touching the use case', async () => {
    const c = makeDealsController();
    await expect(
      c.list('', undefined, undefined, 'garbage-date', undefined, undefined, undefined, undefined, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a malformed toDate with 400', async () => {
    const c = makeDealsController();
    await expect(
      c.list('', undefined, undefined, undefined, 'not-a-date', undefined, undefined, undefined, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a malformed stageId with 400 (per-column board filter)', async () => {
    const c = makeDealsController();
    await expect(
      c.list('', 'not-a-uuid', undefined, undefined, undefined, undefined, undefined, undefined, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown status with 400 (table-view filter)', async () => {
    const c = makeDealsController();
    await expect(
      c.list('', undefined, 'maybe', undefined, undefined, undefined, undefined, undefined, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown sortBy with 400 (table-view sorting)', async () => {
    const c = makeDealsController();
    await expect(
      c.list('', undefined, undefined, undefined, undefined, 'amount', undefined, undefined, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a malformed sortDir with 400 (table-view sorting)', async () => {
    const c = makeDealsController();
    await expect(
      c.list('', undefined, undefined, undefined, undefined, undefined, 'sideways', undefined, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DealsController — permission metadata', () => {
  it('GET /v1/crm/deals requires crm:deal:read', () => {
    expect(permissionsFor(makeDealsController().list as (...args: never[]) => unknown)).toEqual(['crm:deal:read']);
  });
  it('GET /v1/crm/deals/:id requires crm:deal:read (detail + history)', () => {
    expect(permissionsFor(makeDealsController().getById as (...args: never[]) => unknown)).toEqual(['crm:deal:read']);
  });
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

describe('CompaniesController — permission metadata', () => {
  it('GET /v1/crm/companies requires crm:company:read', () => {
    expect(permissionsFor(makeCompaniesController().list as (...args: never[]) => unknown)).toEqual([
      'crm:company:read',
    ]);
  });
  it('GET /v1/crm/companies/:id requires crm:company:read (detail)', () => {
    expect(permissionsFor(makeCompaniesController().getById as (...args: never[]) => unknown)).toEqual([
      'crm:company:read',
    ]);
  });
  it('company mutations require crm:company:write and are audited', () => {
    const c = makeCompaniesController();
    for (const method of [c.create as (...args: never[]) => unknown, c.update as (...args: never[]) => unknown]) {
      expect(permissionsFor(method)).toEqual(['crm:company:write']);
      expect(auditFor(method)).toBeDefined();
    }
  });
});

describe('ActivitiesController — list validation', () => {
  it('rejects a malformed fromDate with 400 before touching the use case', async () => {
    const a = makeActivitiesController(); // use case slot is null — must not be reached
    await expect(a.list('', 'garbage-date', undefined, undefined, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a malformed toDate with 400', async () => {
    const a = makeActivitiesController();
    await expect(a.list('', undefined, 'not-a-date', undefined, undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a malformed assigneeUserId with 400 before touching the use case', async () => {
    const a = makeActivitiesController();
    await expect(
      a.list('', undefined, undefined, 'not-a-uuid', undefined, undefined, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a malformed unassigned flag with 400 before touching the use case', async () => {
    const a = makeActivitiesController();
    await expect(
      a.list('', undefined, undefined, undefined, 'maybe', undefined, undefined, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a malformed completed flag with 400 before touching the use case', async () => {
    const a = makeActivitiesController();
    await expect(
      a.list('', undefined, undefined, undefined, undefined, '1', undefined, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ActivitiesController — update DTO validation', () => {
  it('accepts subject/type/dueAt/assignee partial edits and rejects blanks and bad types', () => {
    // Partial update: any subset of the editable fields is valid.
    expect(updateActivitySchema.parse({ subject: 'Follow-up call' })).toEqual({ subject: 'Follow-up call' });
    expect(updateActivitySchema.parse({ type: 'email' })).toEqual({ type: 'email' });
    expect(updateActivitySchema.parse({ dueAt: '2030-01-01T09:00:00.000Z' })).toEqual({
      dueAt: '2030-01-01T09:00:00.000Z',
    });
    const userId = '2b7a5670-9d47-4c7b-a0b9-9d3f9e1a7d00';
    expect(updateActivitySchema.parse({ assignedToUserId: userId })).toEqual({ assignedToUserId: userId });
    // Reassignment to null unassigns (CRM-14 allows unassigning).
    expect(updateActivitySchema.parse({ assignedToUserId: null })).toEqual({ assignedToUserId: null });
    expect(updateActivitySchema.parse({})).toEqual({});
    // Blank subject, unknown type, and a malformed assignee are rejected (400).
    expect(() => updateActivitySchema.parse({ subject: '   ' })).toThrow();
    expect(() => updateActivitySchema.parse({ type: 'chat' })).toThrow();
    expect(() => updateActivitySchema.parse({ assignedToUserId: 'not-a-uuid' })).toThrow();
    // Unknown fields are rejected (strict).
    expect(() => updateActivitySchema.parse({ subject: 'x', nope: true })).toThrow();
  });
});

describe('ActivitiesController — permission metadata', () => {
  it('GET /v1/crm/activities requires crm:activity:read', () => {
    expect(permissionsFor(makeActivitiesController().list as (...args: never[]) => unknown)).toEqual([
      'crm:activity:read',
    ]);
  });
  it('GET /v1/crm/activities/:id requires crm:activity:read (detail)', () => {
    expect(permissionsFor(makeActivitiesController().getById as (...args: never[]) => unknown)).toEqual([
      'crm:activity:read',
    ]);
  });
  it('every activity mutation requires crm:activity:write and is audited', () => {
    const a = makeActivitiesController();
    for (const method of [
      a.create as (...args: never[]) => unknown,
      a.complete as (...args: never[]) => unknown,
      a.update as (...args: never[]) => unknown,
    ]) {
      expect(permissionsFor(method)).toEqual(['crm:activity:write']);
      expect(auditFor(method)).toBeDefined();
    }
  });
});
