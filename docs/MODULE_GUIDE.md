# ModuBiz — Module Guide

**How to add a new business module.** This is the most important operational
document in the repository: the product thesis is that this process stays cheap
forever.

**Success criterion:** adding a module changes **zero** files under
`apps/api/src/core/` and exactly **two** files outside the module's own folder —
the composition root described in
[ARCHITECTURE.md §3](./ARCHITECTURE.md#the-composition-root-exception).

Read [ARCHITECTURE.md](./ARCHITECTURE.md) first. Rules referenced here are
enforced by [TESTING.md §5](./TESTING.md#5-architecture-boundary-tests).

---

## 1. What is a module?

A module is a **bounded context** that owns:

| It owns                                              | It never owns                          |
| ---------------------------------------------------- | -------------------------------------- |
| Its database tables (single table prefix)            | Any other module's tables              |
| Its HTTP routes under `/v1/<module-key>/...`         | Routes outside its prefix              |
| Its permission keys (`<module>:<resource>:<action>`) | Platform permissions                   |
| Its published event contracts                        | Another module's event names           |
| Its navigation entries and dashboard widgets         | The global shell                       |
| Its migrations, jobs, and search contributor         | The migration runner itself            |
| Its price/entitlement key                            | Pricing amounts (those live in Stripe) |

If two candidate features must share tables to work, they are **one** module. If
they only need to react to each other, they are **two** modules and an event.

---

## 2. The module descriptor

One declarative file is the entire integration surface with the platform.

```typescript
// apps/api/src/modules/inventory/inventory.descriptor.ts
import { defineModule } from '@modubiz/contracts/module';
import { MODULE_KEYS, PERMISSIONS, EVENTS } from '@modubiz/contracts';
import { INVENTORY_STOCK_PORT } from '@modubiz/contracts/ports';

export const inventoryDescriptor = defineModule({
  key: MODULE_KEYS.INVENTORY, // 'inventory' — stable, lowercase, never renamed
  version: '1.0.0',
  name: 'modules.inventory.name', // i18n key, NOT a display string
  description: 'modules.inventory.description',
  icon: 'package',
  tablePrefix: 'inv_',

  // Hard requirements. Boot fails if a dependency is not registered.
  dependsOn: [],

  // Commercial binding. The amount lives in Stripe, never here.
  stripePriceKey: 'modubiz_inventory_monthly',
  trialDays: 14,

  permissions: [
    {
      key: PERMISSIONS.INVENTORY.PRODUCT_READ,
      defaultRoles: ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'],
    },
    {
      key: PERMISSIONS.INVENTORY.PRODUCT_WRITE,
      defaultRoles: ['OWNER', 'ADMIN', 'MANAGER'],
    },
    {
      key: PERMISSIONS.INVENTORY.STOCK_ADJUST,
      defaultRoles: ['OWNER', 'ADMIN', 'MANAGER'],
    },
    {
      key: PERMISSIONS.INVENTORY.STOCK_COUNT,
      defaultRoles: ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'],
    },
    {
      key: PERMISSIONS.INVENTORY.WAREHOUSE_WRITE,
      defaultRoles: ['OWNER', 'ADMIN'],
    },
  ],

  navigation: [
    {
      labelKey: 'modules.inventory.nav.root',
      path: '/m/inventory',
      requiresPermission: PERMISSIONS.INVENTORY.PRODUCT_READ,
      children: [
        {
          labelKey: 'modules.inventory.nav.products',
          path: '/m/inventory/products',
        },
        { labelKey: 'modules.inventory.nav.stock', path: '/m/inventory/stock' },
        {
          labelKey: 'modules.inventory.nav.warehouses',
          path: '/m/inventory/warehouses',
          requiresPermission: PERMISSIONS.INVENTORY.WAREHOUSE_WRITE,
        },
      ],
    },
  ],

  // Public contract: what other modules may rely on.
  publishes: [
    EVENTS.INVENTORY.PRODUCT_CREATED_V1,
    EVENTS.INVENTORY.STOCK_LEVEL_CHANGED_V1,
    EVENTS.INVENTORY.STOCK_DEPLETED_V1,
    EVENTS.INVENTORY.REORDER_POINT_REACHED_V1,
  ],
  consumes: [],

  providesPorts: [INVENTORY_STOCK_PORT],
  consumesPorts: [],

  searchContributor: true,
  dashboardWidgets: ['inventory.low-stock', 'inventory.stock-value'],

  // Rows created when the module is enabled for an org. Must be idempotent.
  onEnableSeed: 'inventory/db/seed-on-enable.ts',

  // What happens to data when the module is disabled.
  dataRetention: { onDisableDays: 90 },
});
```

### Descriptor rules

1. `key` is permanent. Renaming it breaks entitlements, permissions, and billing
   history.
2. `name`/`description`/`labelKey` are **i18n keys**. A literal display string
   here is a bug.
3. `publishes` and `consumes` are the module's **public API**. Anything not
   listed is internal and may change freely.
4. `dependsOn` is validated at boot and at enable time — enabling POS without
   Inventory must fail with `MODULE_DEPENDENCY_MISSING`.
5. `tablePrefix` is unique across the system and is asserted by the architecture
   tests.

---

## 3. Canonical folder skeleton

Generated by `pnpm generate:module <key>`. Do not copy an existing module by
hand — the generator is the source of truth.

```
apps/api/src/modules/<key>/
├── <key>.module.ts
├── <key>.descriptor.ts
├── api/
│   ├── <resource>.controller.ts
│   └── dto/
│       ├── create-<resource>.dto.ts
│       └── <resource>.response.dto.ts
├── application/
│   ├── <verb>-<resource>.use-case.ts
│   └── ports/
├── domain/
│   ├── <aggregate>.entity.ts
│   ├── <value>.vo.ts
│   └── errors.ts
├── infrastructure/
│   └── repositories/<aggregate>.repository.ts
├── events/
│   ├── published/
│   └── handlers/
├── ports/                       # only if providesPorts is non-empty
├── db/
│   ├── schema.ts
│   ├── seed-on-enable.ts
│   └── migrations/
│       ├── 0001_init.sql
│       └── 0002_rls.sql
├── jobs/
├── search/<key>-search.contributor.ts
├── public/index.ts
└── __tests__/
    ├── unit/
    ├── integration/
    └── isolation/<key>.isolation.spec.ts
```

Frontend counterpart:

```
apps/web/src/app/[locale]/(app)/m/<key>/...
apps/web/src/features/<key>/{components,hooks,api,schemas}/
packages/i18n/src/messages/<locale>/modules.<key>.json
```

---

## 4. Step-by-step: adding a module

### Step 0 — Design gate (before any code)

Answer these in the PR description. If any answer is unclear, the module is not
ready to build.

- What is the bounded context, in one sentence?
- Which tables does it own? What is the table prefix?
- Which permissions does it define?
- Which events does it publish? Which does it consume?
- Does it need synchronous data from another module? If yes, which port, and
  **why is eventual consistency insufficient**?
- Does another module need to change to accommodate it? (If yes, stop —
  redesign; that is a boundary smell.)
- What happens to its data when the module is disabled?

### Step 1 — Declare the contract first

In `packages/contracts`:

```typescript
// src/modules.ts
export const MODULE_KEYS = {
  CRM: 'crm',
  INVENTORY: 'inventory',
  POS: 'pos',
} as const;

// src/permissions.ts
export const PERMISSIONS = {
  INVENTORY: {
    PRODUCT_READ: 'inventory:product:read',
    PRODUCT_WRITE: 'inventory:product:write',
    STOCK_ADJUST: 'inventory:stock:adjust',
  },
} as const;

// src/events/inventory.ts
export const EVENTS = {
  INVENTORY: {
    STOCK_DEPLETED_V1: 'inventory.stock.depleted.v1',
  },
} as const;

export const stockDepletedV1Schema = z.object({
  organizationId: z.string().uuid(),
  productVariantId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  occurredAt: z.string().datetime(),
});
export type StockDepletedV1 = z.infer<typeof stockDepletedV1Schema>;
```

Contracts are declared **before** implementation so consumers can be written in
parallel.

### Step 2 — Scaffold

```bash
pnpm generate:module inventory
```

### Step 3 — Schema and migrations

Follow [DATA_MODEL.md](./DATA_MODEL.md) exactly:

- All tenant tables carry the mandatory base columns.
- `0001_init.sql` creates tables and indexes; `0002_rls.sql` enables and forces
  RLS with the standard policy for **every** new table.
- Money columns use the `*_amount_minor` + `*_currency` pair.
- No foreign keys crossing a module prefix.

### Step 4 — Domain layer

Pure TypeScript. Invariants from [BUSINESS_RULES.md](./BUSINESS_RULES.md) are
enforced here, in constructors and methods — not in controllers, not in the
database only.

```typescript
// domain/stock-movement.entity.ts — no Nest, no Drizzle, no I/O
export class StockMovement {
  private constructor(private readonly props: StockMovementProps) {}

  static create(input: CreateStockMovementInput): StockMovement {
    if (input.quantity === 0)
      throw new InvalidStockMovementError('QUANTITY_MUST_BE_NON_ZERO');
    if (input.type === 'ADJUSTMENT' && !input.reasonCode) {
      throw new InvalidStockMovementError('ADJUSTMENT_REQUIRES_REASON');
    }
    return new StockMovement({ ...input, id: newId() });
  }
}
```

### Step 5 — Application layer

One use case per business operation. The use case owns the transaction, calls
the domain, persists through repository interfaces, and collects events to
publish after commit.

```typescript
@Injectable()
export class AdjustStockUseCase {
  constructor(
    private readonly tx: TransactionManager,
    private readonly movements: StockMovementRepository,
    private readonly levels: StockLevelRepository,
    private readonly events: EventBus,
    private readonly audit: AuditLogger,
  ) {}

  async execute(input: AdjustStockInput): Promise<StockLevelSnapshot> {
    const { snapshot, emitted } = await this.tx.run(async () => {
      const movement = StockMovement.create({ ...input, type: 'ADJUSTMENT' });
      await this.movements.append(movement);
      const level = await this.levels.applyMovement(movement);
      await this.audit.record({
        action: 'inventory.stock.adjusted',
        entityId: movement.id,
        meta: input,
      });
      return {
        snapshot: level.toSnapshot(),
        emitted: level.pullDomainEvents(),
      };
    });

    await this.events.publishAll(emitted); // AFTER commit
    return snapshot;
  }
}
```

### Step 6 — API layer

```typescript
@ApiTags('inventory')
@Controller('v1/inventory/stock')
@RequiresModule(MODULE_KEYS.INVENTORY) // entitlement gate
export class StockController {
  constructor(private readonly adjustStock: AdjustStockUseCase) {}

  @Post('adjustments')
  @RequiresPermission(PERMISSIONS.INVENTORY.STOCK_ADJUST)
  @ApiOkResponse({ type: StockLevelResponseDto })
  async adjust(@Body() dto: AdjustStockDto): Promise<StockLevelResponseDto> {
    const result = await this.adjustStock.execute(dto.toInput());
    return StockLevelResponseDto.from(result);
  }
}
```

Controllers contain **no** business logic — validate, delegate, map, return.

### Step 7 — Events

Publish your own; handle others' idempotently.

```typescript
// events/handlers/pos-sale-completed.handler.ts (in the CRM module)
@Injectable()
export class PosSaleCompletedHandler {
  @OnDomainEvent(EVENTS.POS.SALE_COMPLETED_V1)
  async handle(payload: SaleCompletedV1): Promise<void> {
    const parsed = saleCompletedV1Schema.parse(payload); // validate at the boundary
    if (!parsed.customerContactId) return;
    await this.logActivity.execute({/* idempotency key = event id */});
  }
}
```

### Step 8 — Register the module

The only change outside the module folder. Two lines, both in the composition
root — the only place allowed to import a module's `public/` barrel:

```typescript
// apps/api/src/platform/module-registry/registered-modules.ts
export const REGISTERED_MODULES = [
  crmDescriptor,
  inventoryDescriptor,
  posDescriptor, // <-- add
] as const;
```

```typescript
// apps/api/src/app.module.ts
imports: [
  CoreModule,
  PlatformModule,
  CrmModule,
  InventoryModule,
  PosModule /* <-- add */,
];
```

### Step 9 — Billing

1. Create the product + prices in Stripe (monthly and annual) using the
   `stripePriceKey` from the descriptor.
2. Add the mapping to the billing configuration (environment-driven, not
   hardcoded amounts).
3. Verify: start trial → convert → cancel → re-enable, and confirm
   `core_module_entitlements` tracks each transition.

### Step 10 — Frontend

- Routes under `app/[locale]/(app)/m/<key>/`, wrapped in
  `<ModuleGate module="<key>">`.
- Feature code in `features/<key>/`, using the regenerated
  `@modubiz/api-client`.
- Message catalog `modules.<key>.json` for **every** supported locale (missing
  keys fail the i18n check).
- Mutating controls wrapped in `<Can permission="...">`.

### Step 11 — Tests

Mandatory, per [TESTING.md](./TESTING.md):

- Unit tests for every domain invariant.
- Integration tests for each use case against a real Postgres (Testcontainers)
  with RLS active.
- **Tenant-isolation test**: create two orgs, write data in both, assert org A
  can never read, update, or delete org B's rows through any repository or
  endpoint.
- Event contract tests: published payloads validate against the contract schema.
- Entitlement tests: endpoints return `403 MODULE_NOT_ENTITLED` when the module
  is disabled.

### Step 12 — Documentation

- Add the module to the table in [README.md](../README.md).
- Document non-obvious domain rules in [BUSINESS_RULES.md](./BUSINESS_RULES.md)
  (that file is the law; a rule that only exists in code is undiscoverable).
- Regenerate the OpenAPI document and the API client.

---

## 5. Definition of Done checklist

Copy this into the module's PR description.

```markdown
### Contract

- [ ] Module key, permissions, and event names added to @modubiz/contracts
- [ ] Event payload Zod schemas defined and exported
- [ ] Ports (if any) declared in contracts with justification for synchronous
      coupling

### Backend

- [ ] Descriptor complete; all display text uses i18n keys
- [ ] Unique table prefix; migrations create tables + indexes
- [ ] RLS enabled AND forced on every new table, with the standard policy
- [ ] All base columns present on every tenant table
- [ ] Money stored as minor units + currency; no float
- [ ] Domain layer has zero framework/IO imports
- [ ] One use case per operation; transactions owned by the use case
- [ ] Events published only after commit; handlers idempotent
- [ ] Audit entries recorded for all mutating operations
- [ ] Controllers annotated with @RequiresModule and @RequiresPermission
- [ ] No import from another module's source (architecture test green)
- [ ] Registered in registered-modules.ts and app.module.ts (and nothing else in
      core/)

### Billing

- [ ] Stripe product + prices created; key matches the descriptor
- [ ] Trial start / convert / cancel / re-enable verified end to end

### Frontend

- [ ] Routes gated by <ModuleGate>; controls gated by <Can>
- [ ] Zero hardcoded user-facing strings
- [ ] Message catalogs complete for en, ar, fr, es
- [ ] RTL verified with the ar locale; only logical CSS utilities used
- [ ] Money and dates rendered via shared formatters

### Quality

- [ ] Unit tests for every domain invariant
- [ ] Integration tests per use case against real Postgres with RLS
- [ ] Tenant-isolation test present and passing
- [ ] Entitlement-denied tests present
- [ ] Coverage gates met (domain/application ≥ 90%)
- [ ] OpenAPI regenerated; api-client regenerated

### Documentation

- [ ] README module table updated
- [ ] Domain rules recorded in BUSINESS_RULES.md
- [ ] Data retention behaviour on disable documented in the descriptor
```

---

## 6. Anti-patterns (reject in review)

| Anti-pattern                                                                  | Why it is fatal                                                          | Do instead                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `import { InventoryService } from '../inventory/...'`                         | Destroys the boundary and the extraction path                            | Event, or a declared port                                                            |
| Joining `pos_sales` to `crm_contacts` in SQL                                  | Couples schemas permanently                                              | Store `customerContactId` and resolve via a port/read model                          |
| Adding a field to `core/` "just for this module"                              | Core becomes a dumping ground; every module change becomes a core change | Keep it in the module, or generalize deliberately via a core abstraction with an ADR |
| Business logic in a controller                                                | Untestable, unreusable, bypassed by jobs and event handlers              | Move to a use case                                                                   |
| Manual `where organizationId = ...`                                           | Signals that tenant context was bypassed; RLS is the real defence        | Rely on `TransactionManager`                                                         |
| `float`/`number` money, or `toFixed(2)`                                       | Silent financial corruption                                              | `@modubiz/money`                                                                     |
| Hardcoded English string                                                      | Blocks all non-English markets                                           | i18n key                                                                             |
| A module that only works if another is enabled, without declaring `dependsOn` | Runtime failure for tenants                                              | Declare the dependency                                                               |
| Publishing an event nobody listens to "for later"                             | Dead contract that must be maintained forever                            | Add it when a consumer exists                                                        |
| Renaming a published event in place                                           | Breaks every consumer silently                                           | Publish `.v2` alongside `.v1`, migrate, then retire                                  |

---

## 7. Event versioning policy

- Event names are immutable once merged. Adding **optional** fields is backward
  compatible and allowed within the same version.
- Any removal, rename, or type change requires a new major: `<name>.v2`.
- Both versions are published during migration; `v1` is removed only after every
  consumer moves and one release cycle passes.
- The contracts package records the deprecation with a `@deprecated` tag and a
  target removal release.

---

## 8. Related documents

[PRD.md](./PRD.md) · [TECH_STACK.md](./TECH_STACK.md) ·
[ARCHITECTURE.md](./ARCHITECTURE.md) · [DATA_MODEL.md](./DATA_MODEL.md) ·
[BUSINESS_RULES.md](./BUSINESS_RULES.md) ·
[CODING_STANDARDS.md](./CODING_STANDARDS.md) · [TESTING.md](./TESTING.md)
