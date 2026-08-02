// Canonical module skeleton templates (MODULE_GUIDE.md §3).
// Each template is a function of the token map:
//   __KEY__        lowercase key, e.g. "demo"
//   __Key__        PascalCase, e.g. "Demo"
//   __KEY_UPPER__  SCREAMING_SNAKE, e.g. "DEMO"
//   __RESOURCE__   default resource name, e.g. "item"

import { pascalCase, screamingSnake } from './helpers.mjs';

/** Build the token map for a module key. */
export function tokens(key) {
  return {
    __KEY__: key,
    __Key__: pascalCase(key),
    __KEY_UPPER__: screamingSnake(key),
    __RESOURCE__: 'item',
  };
}

/** Replace all tokens in a template string. */
export function render(template, t) {
  return Object.entries(t).reduce((acc, [token, value]) => acc.split(token).join(value), template);
}

const descriptorTemplate = `import { defineModule, type ModuleDescriptor } from '@modubiz/contracts';

/**
 * __Key__ module descriptor — the entire integration surface with the platform.
 *
 * @see MODULE_GUIDE.md §2 — Descriptor rules
 */
export const __KEY__Descriptor: ModuleDescriptor = defineModule({
  key: '__KEY__',
  version: '1.0.0',
  nameKey: 'modules.__KEY__.name',
  descriptionKey: 'modules.__KEY__.description',
  icon: '__KEY__',
  tablePrefix: '__KEY___',
  dependsOn: [],
  stripePriceKey: 'price___KEY___monthly',
  trialDays: 14,
  permissions: ['__KEY__:__RESOURCE__:read', '__KEY__:__RESOURCE__:write'],
  navigation: [
    {
      labelKey: 'modules.__KEY__.nav.root',
      href: '/m/__KEY__',
    },
  ],
  publishes: ['__KEY__.__RESOURCE__.created.v1'],
  consumes: [],
  providesPorts: [],
  consumesPorts: [],
  searchContributor: false,
  dashboardWidgets: [
    {
      id: '__KEY__-overview',
      titleKey: 'modules.__KEY__.widgets.overview',
      width: 2,
      height: 1,
    },
  ],
  dataRetentionDays: 90,
});
`;

const moduleTemplate = `import { Module } from '@nestjs/common';

import { __Key__Controller } from './api/index.js';
import { GetStatusUseCase } from './application/index.js';

/**
 * __Key__Module — Nest composition of the __KEY__ bounded context.
 *
 * @see MODULE_GUIDE.md §3 — Canonical folder skeleton
 */
@Module({
  controllers: [__Key__Controller],
  providers: [GetStatusUseCase],
})
export class __Key__Module {}
`;

const controllerTemplate = `import { Controller, Get } from '@nestjs/common';

import { PublicRoute } from '../../../core/tenancy/system-context.decorator.js';
import { GetStatusUseCase } from '../application/index.js';

/**
 * __Key__ controller. No business logic — validate, delegate, map, return.
 *
 * @see MODULE_GUIDE.md §4 — Step 6: API layer
 */
@Controller('v1/__KEY__')
export class __Key__Controller {
  constructor(private readonly getStatus: GetStatusUseCase) {}

  /** Public status probe (replace with @RequiresModule + @RequiresPermission routes). */
  @PublicRoute()
  @Get('status')
  async status(): Promise<{ data: { module: string; status: string } }> {
    return { data: await this.getStatus.execute() };
  }
}
`;

const apiBarrelTemplate = `export { __Key__Controller } from './__KEY__.controller.js';
`;

const apiDtoTemplate = `import { z } from 'zod';

// Wire DTOs for the __KEY__ module live here (see MODULE_GUIDE.md §4 Step 6).
// Example:
// export const createItemSchema = z
//   .object({ name: z.string().min(1).max(200) })
//   .strict();
// export type CreateItemDto = z.infer<typeof createItemSchema>;
`;

const apiDtoBarrelTemplate = `// DTO barrel for the __KEY__ module. Add schemas above as they are created.
`;

const applicationUseCaseTemplate = `import { Injectable } from '@nestjs/common';

/**
 * Trivial scaffold use case — replace with the module's real business use cases
 * (one use case per operation, owning its transaction; see MODULE_GUIDE.md §4
 * Step 5).
 */
@Injectable()
export class GetStatusUseCase {
  async execute(): Promise<{ module: string; status: string }> {
    return { module: '__KEY__', status: 'ok' };
  }
}
`;

const applicationBarrelTemplate = `export { GetStatusUseCase } from './get-status.use-case.js';
`;

const applicationPortsTemplate = `// Application-layer ports (repository interfaces) for the __KEY__ module.
// See MODULE_GUIDE.md §4 Step 5 — the use case depends on these interfaces,
// never on Drizzle or the infrastructure layer.
`;

const domainEntityTemplate = `/**
 * Trivial scaffold entity for the __KEY__ module.
 * Pure TypeScript — no framework, no I/O (hard rule #7).
 *
 * Replace with the module's real aggregates and invariants, citing the
 * business rules they enforce (see MODULE_GUIDE.md §4 Step 4).
 */
export class __Key__Item {
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}
}
`;

const domainErrorsTemplate = `/**
 * Domain error for the __KEY__ module.
 * Codes are stable machine-readable strings surfaced by the API as error codes.
 */
export class __Key__DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = '__Key__DomainError';
  }
}
`;

const domainBarrelTemplate = `export { __Key__Item } from './__KEY__.item.js';
export { __Key__DomainError } from './errors.js';
`;

const infrastructureBarrelTemplate = `// Infrastructure layer for the __KEY__ module.
// Drizzle repositories + external adapters live here (MODULE_GUIDE.md §4).
`;

const eventsBarrelTemplate = `// Events layer for the __KEY__ module.
// Published event contracts + idempotent handlers (MODULE_GUIDE.md §4 Step 7).
`;

const eventsPublishedTemplate = `// Published event payload contracts for the __KEY__ module.
// Declare the event name + Zod schema here and export it from @modubiz/contracts.
`;

const eventsHandlersTemplate = `// Event handlers for the __KEY__ module.
// Handlers validate the payload, delegate to a use case, and stay idempotent.
`;

const jobsBarrelTemplate = `// BullMQ jobs for the __KEY__ module (TEN-6: payloads carry organizationId).
`;

const searchContributorTemplate = `import { type SearchContributor, type SearchResult } from '@modubiz/contracts';

/**
 * Federated-search contributor for the __KEY__ module.
 * Registered by the composition root when searchContributor: true.
 *
 * @see ARCHITECTURE.md §6 — Federated search
 */
export class __Key__SearchContributor implements SearchContributor {
  readonly moduleKey = '__KEY__';
  readonly labelKey = 'modules.__KEY__.name';

  async search(_query: string, _organizationId: string, _limit: number): Promise<SearchResult[]> {
    return [];
  }
}
`;

const schemaTemplate = `// Drizzle schema for the __KEY__ module.
// Follow DATA_MODEL.md §2 (base columns + RLS) and §5 (money pairs).
// Table prefix: __KEY___ (globally unique).
`;

const seedOnEnableTemplate = `// Idempotent seed run when the __KEY__ module is enabled for an organization.
// Must be safe to run multiple times (MODULE_GUIDE.md §4 Step 9).
`;

const migrationInitTemplate = `-- 0001_init.sql — __KEY__ module initial schema
-- Follow DATA_MODEL.md §2 exactly: mandatory base columns on every tenant table.
-- Replace the example table below with the module's real schema.

CREATE TABLE __KEY___items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Partial unique indexes (per organization) go here.
`;

const migrationRlsTemplate = `-- 0002_rls.sql — RLS for __KEY__ tables (DATA_MODEL.md §2)
-- MUST be applied for EVERY tenant table created in 0001.

ALTER TABLE __KEY___items ENABLE ROW LEVEL SECURITY;
ALTER TABLE __KEY___items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON __KEY___items
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
`;

const publicBarrelTemplate = `// Module public barrel — imported ONLY by the composition root
// (app.module.ts and platform/module-registry/registered-modules.ts).
export { __Key__Module } from '../__KEY__.module.js';
export { __KEY__Descriptor } from '../__KEY__.descriptor.js';
`;

const unitTestTemplate = `import { describe, expect, it } from 'vitest';

import { __Key__Item } from '../../domain/index.js';

describe('__Key__Item', () => {
  it('constructs an item with id and name', () => {
    const item = new __Key__Item('id-1', 'First item');
    expect(item.id).toBe('id-1');
    expect(item.name).toBe('First item');
  });
});
`;

const integrationTestTemplate = `import { describe, expect, it } from 'vitest';

import { __KEY__Descriptor } from '../../__KEY__.descriptor.js';

// Integration tests for the __KEY__ module run against real Postgres with RLS
// active (TESTING.md §4). Add use-case-level tests here once implemented.
describe('__KEY__ module integration', () => {
  it('registers a valid module descriptor', () => {
    expect(__KEY__Descriptor.key).toBe('__KEY__');
    expect(__KEY__Descriptor.tablePrefix).toBe('__KEY___');
  });
});
`;

const isolationTestTemplate = `import { describe, expect, it } from 'vitest';

import { __KEY__Descriptor } from '../../__KEY__.descriptor.js';

/**
 * Tenant-isolation tests for the __KEY__ module (TESTING.md §6).
 *
 * Required cases once the module has data + endpoints:
 *  - cross-org read / update / delete / list ⇒ denied (RLS)
 *  - injected organizationId ignored
 *  - no tenant context ⇒ zero rows (fail closed)
 *  - entitlement denial (MODULE_NOT_ENTITLED)
 *  - permission denial
 */
describe('__KEY__ isolation', () => {
  it('registers a valid module descriptor', () => {
    expect(__KEY__Descriptor.key).toBe('__KEY__');
  });
});
`;

/** All backend files generated under apps/api/src/modules/<key>/. */
export function backendFiles(key) {
  const t = tokens(key);
  const r = (template) => render(template, t);

  return [
    [`apps/api/src/modules/${key}/${key}.descriptor.ts`, r(descriptorTemplate)],
    [`apps/api/src/modules/${key}/${key}.module.ts`, r(moduleTemplate)],
    [`apps/api/src/modules/${key}/api/${key}.controller.ts`, r(controllerTemplate)],
    [`apps/api/src/modules/${key}/api/index.ts`, r(apiBarrelTemplate)],
    [`apps/api/src/modules/${key}/api/dto/index.ts`, r(apiDtoBarrelTemplate)],
    [`apps/api/src/modules/${key}/api/dto/${key}.dto.ts`, r(apiDtoTemplate)],
    [`apps/api/src/modules/${key}/application/get-status.use-case.ts`, r(applicationUseCaseTemplate)],
    [`apps/api/src/modules/${key}/application/index.ts`, r(applicationBarrelTemplate)],
    [`apps/api/src/modules/${key}/application/ports/index.ts`, r(applicationPortsTemplate)],
    [`apps/api/src/modules/${key}/domain/${key}.item.ts`, r(domainEntityTemplate)],
    [`apps/api/src/modules/${key}/domain/errors.ts`, r(domainErrorsTemplate)],
    [`apps/api/src/modules/${key}/domain/index.ts`, r(domainBarrelTemplate)],
    [`apps/api/src/modules/${key}/infrastructure/index.ts`, r(infrastructureBarrelTemplate)],
    [`apps/api/src/modules/${key}/events/index.ts`, r(eventsBarrelTemplate)],
    [`apps/api/src/modules/${key}/events/published/index.ts`, r(eventsPublishedTemplate)],
    [`apps/api/src/modules/${key}/events/handlers/index.ts`, r(eventsHandlersTemplate)],
    [`apps/api/src/modules/${key}/jobs/index.ts`, r(jobsBarrelTemplate)],
    [`apps/api/src/modules/${key}/search/${key}-search.contributor.ts`, r(searchContributorTemplate)],
    [`apps/api/src/modules/${key}/db/schema.ts`, r(schemaTemplate)],
    [`apps/api/src/modules/${key}/db/seed-on-enable.ts`, r(seedOnEnableTemplate)],
    [`apps/api/src/modules/${key}/db/migrations/0001_init.sql`, r(migrationInitTemplate)],
    [`apps/api/src/modules/${key}/db/migrations/0002_rls.sql`, r(migrationRlsTemplate)],
    [`apps/api/src/modules/${key}/public/index.ts`, r(publicBarrelTemplate)],
    [`apps/api/src/modules/${key}/__tests__/unit/${key}.spec.ts`, r(unitTestTemplate)],
    [`apps/api/src/modules/${key}/__tests__/integration/${key}.integration.spec.ts`, r(integrationTestTemplate)],
    [`apps/api/src/modules/${key}/__tests__/isolation/${key}.isolation.spec.ts`, r(isolationTestTemplate)],
  ];
}
