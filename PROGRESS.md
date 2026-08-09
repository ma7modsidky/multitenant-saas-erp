# ModuBiz — Development Progress Tracker

**Last updated:** Session 68 — E2E Journeys workflow verified end-to-end on a
real GitHub runner via `workflow_dispatch`: **GREEN (all 16 steps)**, with the
CRM, Inventory, and POS journeys passing (3 passed in 31.3s). Three
fresh-checkout bugs the local stack couldn't catch were found and fixed by the
real runs: the web build needs the workspace packages compiled first (turbo
`pnpm build`), the readiness poll now accepts the API's auth-gated 401 (mirrors
Playwright's own webServer check), and the Playwright browser install resolves
the binary via `pnpm --filter web exec` (no root-level dep).

**Previous (Session 66):** POS journey spec confirmed + committed E2E seeder.
The previously never-run `pos-journey.e2e.spec.ts` now passes against an
API-seeded session (combobox accessible-name selectors fixed, checkout
preselects the register via the row's "New sale" link), the inventory journey
fixed the same way, and a new committed `scripts/seed-e2e-env.mjs` +
`apps/web/playwright.journey.config.ts` make all three journey specs runnable on
demand (`pnpm e2e:seed && pnpm test:e2e:journeys`) — 3/3 green twice. **Current
phase:** Phase 6 — POS Module (full stack done except the offline PWA)

> This file tracks where we are in [PLAN.md](./PLAN.md). Update it at the end of
> every work session.

---

## Phase status

| Phase                                 | Status         | Notes                                                         |
| ------------------------------------- | -------------- | ------------------------------------------------------------- |
| 0 — Foundation & Tooling              | ✅ Complete    | All 0.1–0.7 done; DoD verified                                |
| 1 — Core Shared Kernel                | ✅ Complete    | All 1.1–1.12 done; DoD verified                               |
| 2 — Platform + Frontend Shell         | ✅ Complete    | Unit + arch + integration + E2E green; committed (Session 19) |
| 3 — Module Framework & Generator      | ✅ Complete    | Descriptor system, generator, registry, ports, demo proof     |
| 4 — CRM Module                        | ✅ Complete    | Full stack, contracts → UI (Sessions 24–55); DoD verified     |
| 5 — Inventory Module                  | ✅ Complete    | Full stack (Sessions 56–57); DoD verified                     |
| 6 — POS Module                        | 🚧 Full stack  | 6.1–6.6 + 6.9 + 6.7 non-PWA (Sessions 64–65); PWA deferred    |
| 7 — Production Hardening & Deployment | ⬜ Not started |                                                               |

---

## Phase 5 — Detailed progress

### 5.1–5.7 Backend (contracts → schema → domain → application → port → API/jobs)

- [x] **5.1 Contracts** — `MODULE_KEYS.INVENTORY`, 5 permissions, `inventory.*`
      events (created/archived/level_changed/depleted/reorder_point),
      `INVENTORY_STOCK_PORT` (getAvailability/reserve/commit/release, Level 3
      `TransactionRef`)
- [x] **5.2 Scaffold** — `pnpm generate:module inventory`
- [x] **5.3 Schema** — `0001_init.sql` (11 tables), `0002_rls.sql`,
      `0003_append_only.sql` (INV-1 trigger); unique SKU/barcode (INV-10),
      idempotency key (INV-16), stock-level key
- [x] **5.4 Domain** — movement (INV-3/4), stock-level projection (INV-2/5),
      reservation state machine (INV-7/8), archive-not-delete (INV-11), stock
      count (INV-14); 27 unit tests
- [x] **5.5 Application** — create/archive/receive (moving average
      INV-12)/adjust (INV-4/6)/transfer
      (INV-9)/reserve/commit/release/apply-count; 14 integration tests incl.
      INV-16 idempotency
- [x] **5.6 Port** — `InventoryStockPortImpl` +
      `TransactionManager.ref()/resolveRef()` (Phase 3.4 `TransactionRef`
      minting completed); reserve→commit/release atomic in-tx
- [x] **5.7 API/events/search/jobs** — `v1/inventory/*` controllers with
      `@RequiresModule`+`@RequiresPermission`, events after commit, product
      search contributor, reservation-expiry / low-stock-alert /
      stock-reconciliation jobs; `GET /v1/inventory/stock/movements` + unit-cost
      fields on stock levels

### 5.8 Frontend

- [x] **Backend support finished** — `listMovements` repo method, movement list
      route + DTOs, unit-cost on stock levels; circular import in
      `packages/contracts/events/inventory.ts` fixed
- [x] **API bindings** — inventory section in `lib/api/resources.ts` (products,
      stock, movements, warehouses, counts, transfers)
- [x] **`features/inventory/`** — `money.ts` (BigInt math), `schemas.ts`,
      `hooks.ts`, `forms.tsx`, `labels.ts`, `errors.ts`, 6 views (products,
      stock levels, movements ledger, transfers, stock counts, warehouses);
      error-key namespace bug fixed per review
- [x] **Dashboard widgets** — low-stock (`available < reorderPoint`, INV-13
      semantics) + stock valuation (per-currency, exact integer math), wired
      into the dashboard
- [x] **Routes** —
      `m/inventory/{products, warehouses, stock,     stock/movements, stock/transfers, stock-counts}` +
      landing redirect
- [x] **i18n** — full `modules.inventory.*` key set in en/ar/fr/es + widget
      empty states; parity test
- [x] **Tests** — widget i18n regression, money/quantity/error-mapper units,
      `inventory-journey.e2e.spec.ts` (mirrors CRM, self-skips without seeded
      env)
- [x] **Accessibility** — `htmlFor`/`id` label association on all form fields

### 5.9 Isolation & architecture tests

- [x] `inventory.isolation.spec.ts` — **11/11 passing**: TEN-1 cross-org
      read/update/archive/product-list/ledger/warehouse/stock-count denial,
      TEN-2 injected `organizationId` ignored, TEN-3 no-context zero rows,
      AUTHZ-6 `MODULE_NOT_ENTITLED`, AUTHZ-5 permission denial
- [x] INV-1 append-only enforcement test added to the integration suite
      (UPDATE/DELETE on `inv_stock_movements` rejected by trigger)
- [x] Validation: API unit **1446/1446** · inventory integration **14/14** · web
      **184/184** · i18n parity · `test:arch` 0 errors · typechecks clean

---

## Phase 3 — Detailed progress

### 3.1 Module descriptor system (`@modubiz/contracts/module`)

- [x] `defineModule()` — validates `ModuleDescriptor` at definition time (i18n
      keys, table prefix format, permission/event prefix rules)
- [x] `validateDescriptors()` + `DESCRIPTOR_ERROR` codes — shared cross-
      descriptor validation (duplicate key/prefix/permission/event/port, missing
      dependency, missing consumed event/port)
- [x] `module.spec.ts` — 18 unit tests (packages/contracts/**tests**/)
- [x] `MODULE_KEYS` grows `DEMO: 'demo'` for the framework proof

### 3.2 Module generator (`tooling/generators/module`)

- [x] `@modubiz/generator-module` package — `pnpm generate:module <key>`
- [x] Scaffolds the canonical backend skeleton (28 files): descriptor, module
      class, api/ + dto/, application/ + ports/, domain/ + errors,
      infrastructure/, events/ (published + handlers), jobs/, search/
      contributor, db/ (schema, seed-on-enable, 0001_init.sql + 0002_rls.sql),
      public/index.ts, and **tests**/{unit,integration,isolation}
- [x] Scaffolds the frontend counterpart: `(dashboard)/m/<key>/page.tsx` (gated
      by `<ModuleGate>`) + `features/<key>/`
- [x] Auto-registration: MODULE_KEYS entry (contract-first), descriptor in
      `registered-modules.ts`, module class in `app.module.ts`, and
      `modules.<key>` i18n keys inserted into all 4 locale catalogs
- [x] Idempotent: re-running skips existing files and registrations
- [x] Key validation (lowercase 2–24 chars) + CRLF-aware file editing

### 3.3 Registry wiring & boot validation

- [x] `BootValidationService` refactored to use the shared
      `validateDescriptors()` from contracts (single source of truth for error
      codes)
- [x] `boot-validation.service.spec.ts` — 7 service-level tests (incl. prune
      mirror-semantics coverage)
- [x] **Catalog prune on boot** — `syncToDatabase` now calls
      `pruneStaleModules(registeredKeys)`: catalog rows + permissions for
      modules no longer registered are deleted (FK-guarded — a row referenced by
      an entitlement is kept and logged). Fixes the leftover-module-in-
      marketplace bug where a module removed from `registered-modules.ts` kept
      showing up in `GET /v1/modules` because the DB mirror only upserted.
- [x] **Dashboard widget registration** — `GetDashboardWidgetsUseCase` (derived
      from entitlements + descriptors) + `GET /v1/me/dashboard/widgets` endpoint
- [x] Frontend `useDashboardWidgets()` hook + widget grid on the dashboard page
      (registered widgets render; never hardcoded)
- [x] `get-dashboard-widgets.spec.ts` — 4 tests

### 3.4 Port registration infrastructure

- [x] `TransactionRef` type in `@modubiz/contracts` (opaque, minted only by
      TransactionManager) + `PortToken` type
- [x] `core/ports/` — `PortRegistry` (register/resolve/has/tokens) + global
      `PortsModule`, wired into AppModule
- [x] `port-registry.spec.ts` — 6 tests (duplicate provider, missing token,
      transactional port resolve)

### 3.5 Framework proof (throwaway `demo` module)

- [x] `pnpm generate:module demo` produced 28 backend files + web page + i18n
      keys
- [x] API + web typecheck pass with demo registered; demo unit/integration/
      isolation specs run green; API lint 0 errors; all 8 arch tests pass;
      depcruise 0 errors
- [x] Demo deleted + all registration edits reverted — framework unchanged (git
      diff clean of demo)
- [x] **Zero `core/` changes were required to add the module** — framework
      validation milestone met

### Phase 3 — Framework fixes (done as part of the phase)

- [x] Search contributor contract moved to `@modubiz/contracts`
      (`SearchContributor`, `SearchResult`, `SEARCH_CONTRIBUTORS` token) so
      modules can implement search without importing `platform/`
- [x] Arch test: "modules never import platform" added
- [x] depcruise + arch tests: `registered-modules.ts` explicitly allowed as
      composition root (platform→modules exception)
- [x] Arch tests hardened for Windows path separators (normalized `\` → `/`)

### Phase 3 — Definition of Done

| #   | Criterion                                                                 | Status                                   |
| --- | ------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | `defineModule()` + `ModuleDescriptor` type in `@modubiz/contracts/module` | ✅                                       |
| 2   | `pnpm generate:module <key>` produces a valid, compiling module           | ✅ (verified with demo)                  |
| 3   | Boot validation catches all descriptor conflicts                          | ✅ (shared validateDescriptors + tests)  |
| 4   | Port registry infrastructure works                                        | ✅ (core/ports + tests)                  |
| 5   | Framework proof: demo added with zero `core/` changes                     | ✅ (verified + reverted)                 |
| 6   | Arch test: "only composition root imports a module's public barrel" green | ✅ (incl. Windows path handling)         |
| 7   | Generator is the documented source of truth                               | ✅ (MODULE_GUIDE §3 aligns to generator) |

---

## Phase 2 — Detailed progress

### 2.1 Database migrations — core platform tables

- [x] `0001_global_tables.sql` — core_users, core_sessions, core_organizations,
      core_currencies, core_fx_rates, core_module_catalog, core_permissions
- [x] `0002_tenant_tables.sql` — core_memberships, core_roles,
      core_role_permissions, core_invitations, core_subscriptions,
      core_module_entitlements, core_audit_log, core_notifications, core_outbox,
      core_data_exports, core_organization_settings
- [x] `0003_rls.sql` — Standard RLS block for all 11 tenant tables
- [x] `0004_triggers.sql` — set_updated_at() function + trigger attachments
- [x] `0005_append_only.sql` — Append-only protection for core_audit_log (full)
      and core_outbox (DELETE only)

### 2.3 Users & Auth flows (`platform/users`)

- [x] User entity with email normalization (AUTH-1), password hashing (AUTH-2),
      email verification state (AUTH-3)
- [x] DrizzleUserRepository for core_users table
- [x] Signup use case — email uniqueness check, password hashing
- [x] Login use case — rate limiting (AUTH-7), generic errors (AUTH-8), token
      generation (AUTH-4)
- [x] Password reset — single-use token, 60-min expiry, stored hashed (AUTH-9)
- [x] Password change — revokes all sessions (AUTH-6)
- [x] Session management — list sessions, revoke individually (AUTH-5)
- [x] Token refresh — rotation with reuse detection (AUTH-4)
- [x] Auth controller — system-context routes (@PublicRoute)
- [x] Users controller — authenticated profile and session endpoints
- [x] Zod DTO validation with password strength requirements (min 12 chars)

### 2.4 Memberships & Invitations (`platform/memberships`)

- [x] Membership entity with role change / soft-delete behaviour (AUTHZ-1,
      AUTHZ-7)
- [x] Invitation entity with accept / revoke / expiry behaviour (AUTH-9,
      AUTHZ-8)
- [x] DrizzleMembershipRepository for core_memberships table
- [x] DrizzleInvitationRepository for core_invitations table
- [x] InviteUserUseCase — email normalization, membership clash check, hashed
      token (AUTHZ-8, AUTH-9)
- [x] AcceptInvitationUseCase — validates pending/expired, creates membership
      (AUTH-3, AUTH-9)
- [x] RemoveMemberUseCase — last-member check, soft-delete (AUTHZ-1)
- [x] UpdateMembershipRoleUseCase — last-owner demotion guard, cannot change own
      role (AUTHZ-1, AUTHZ-3)
- [x] SwitchOrgUseCase — re-issues JWT tokens scoped to new org (TEN-4)
- [x] MembershipsController — list members, list invitations, invite, accept,
      remove, update role, switch org
- [x] Zod DTO validation on invite, role update, switch org
- [x] Wired in AppModule, lint + typecheck pass cleanly

### 2.5 Roles & RBAC (`platform/roles`)

- [x] System roles — OWNER, ADMIN, MANAGER, MEMBER, VIEWER with full permission
      matrix per BUSINESS_RULES.md §3
- [x] Custom roles — AUTHZ-4 enforcement: custom roles cannot include
      platform-admin permissions
- [x] Ownership transfer (AUTHZ-2) — nominate → promote → former owner steps
      down to ADMIN
- [x] Role entity with update/delete behaviour (system roles immutable,
      last-owner guard)
- [x] DrizzleRoleRepository for core_roles + core_role_permissions tables
- [x] CreateRoleUseCase — duplicate key check, AUTHZ-4 validation
- [x] UpdateRoleUseCase — metadata + permission updates
- [x] DeleteRoleUseCase — last-owner guard, system-role immutability
- [x] AssignRoleUseCase — AUTHZ-3: cannot change own role, cannot grant unowned
      permissions
- [x] GetRoleMatrixUseCase — system roles + custom roles + permission catalog
- [x] RolesController — CRUD + matrix endpoint + assign-role +
      transfer-ownership
- [x] Zod DTO validation with key format enforcement
- [x] Wired in AppModule with MembershipsModule dependency, lint + typecheck
      pass
- [x] **Domain unit tests** — 37 tests covering AUTHZ-2 (isOwnerRole), AUTHZ-4
      (all 10 platform permissions), role matrix (hierarchy containment), system
      role immutability, last-owner guard, update/delete behaviour

### 2.6 Billing & Stripe (`platform/billing`)

- [x] Domain: Subscription entity, state machine (BILL-3, BILL-6, BILL-7), error
      constants
- [x] Ports: BillingRepository, StripePort interfaces
- [x] DrizzleBillingRepository — core_subscriptions + core_module_entitlements +
      core_module_catalog
- [x] FakeStripeAdapter — in-memory dev adapter simulating Stripe API
- [x] CreateSubscriptionUseCase — initial subscription with Stripe customer +
      items
- [x] EnableModuleTrialUseCase — trial activation with dependency check (BILL-2,
      BILL-8)
- [x] DisableModuleUseCase — disable with dependent module guard (BILL-9),
      purge_after
- [x] HandleWebhookUseCase — idempotent Stripe webhook processing (BILL-5)
- [x] ReconcileEntitlementsUseCase — nightly comparison, Stripe wins on conflict
      (BILL-4)
- [x] GetBillingUseCase — subscription + entitlements query
- [x] BillingController — CRUD + trial + disable + reconcile + webhook endpoints
- [x] Zod DTO schemas with validation
- [x] BillingModule wire-up with custom EntitlementStoreProvider
- [x] Wired in AppModule, lint + typecheck pass cleanly

### 2.7 Module registry (`platform/module-registry`)

- [x] `registered-modules.ts` — CRM, Inventory, POS descriptors via
      `defineModule()` from `@modubiz/contracts`
- [x] Boot validation — missing dependency, duplicate permission, duplicate
      event, duplicate table prefix checks
- [x] Boot-time sync — descriptors mirrored to `core_module_catalog` +
      `core_permissions`
- [x] `GET /v1/modules` — public catalog endpoint (no auth)
- [x] `GET /v1/me/navigation` — navigation derived from entitlements
- [x] `POST /v1/organizations/:orgId/modules/enable` — BILL-8 dep validation
- [x] `POST /v1/organizations/:orgId/modules/disable` — BILL-9 dependent guard
- [x] DrizzleModuleRegistryRepository for catalog, permissions, entitlements
      queries
- [x] Zod DTO validation
- [x] Wired in AppModule with `onModuleInit` boot validation
- [x] `@modubiz/contracts` added to api dependencies
- [x] Lint + typecheck pass cleanly

### 2.8 Audit log API, Search, FX rates

#### Audit Log (`platform/audit-log`)

- [x] `GET /v1/organizations/:orgId/audit-log` — queryable by actor, entity
      type, entity ID, action, date range
- [x] Pagination (page/pageSize, max 200 per page)
- [x] DrizzleAuditLogRepository with parameterized SQL using `sql` template +
      `sql.join()`
- [x] RLS-enforced — organization_id always in WHERE clause

#### Search (`platform/search`)

- [x] Federated search aggregator — `GET /v1/search?q=<query>`
- [x] `SearchContributor` interface — modules register via `SEARCH_CONTRIBUTORS`
      multi-provider
- [x] `Promise.allSettled` — broken contributors don't crash search
- [x] Minimum 2-char query requirement

#### FX Rates (`platform/fx-rates`)

- [x] `GET /v1/currencies` — list supported currencies
- [x] `GET /v1/fx-rates/:baseCurrency` — latest rates for all pairs
- [x] `GET /v1/fx-rates/:baseCurrency/:quoteCurrency` — rate lookup with
      optional historical date
- [x] `GET /v1/fx-rates/snapshot` — manual snapshot (mock rates for dev)
- [x] `GetFxRateUseCase` — CUR-6: uses most recent prior snapshot
- [x] `SnapshotFxRatesUseCase` — daily snapshot job stub (mock provider)
- [x] `DrizzleFxRatesRepository` — core_fx_rates + core_currencies queries

### 2.9 Frontend Shell (`apps/web`)

- [x] UI primitives: Button (with `asChild`, loading spinner, CVA variants),
      Input (error state), Label, Card, Separator, Skeleton
- [x] ShellLayout — sidebar (collapsible w-64/w-16) + topbar (user menu, theme
      toggle, locale switcher) + main content area
- [x] Auth pages under `(auth)` route group: login, signup, forgot-password,
      reset-password with Zod-style forms
- [x] Invitation acceptance page: `(auth)/invitations/[id]/page.tsx` —
      auto-accepts token, shows result, redirects
- [x] Dashboard page under `(dashboard)` route group: stats grid, module cards
      with hover effects, recent activity
- [x] i18n: All new UI strings added to en, ar, fr, es catalogs (~30 new keys
      per locale)
- [x] Logical CSS throughout (ms-, me-, start-, end-, border-e) — no directional
      utilities
- [x] Accessibility: aria-labels, aria-busy, keyboard operability, semantic HTML
- [x] Added deps (clsx, tailwind-merge, class-variance-authority) to web
      package.json
- [x] Typecheck passes cleanly; lint errors only from pre-existing code

---

## Phase 0 — Detailed progress

### 0.1 Initialize the monorepo

- [x] Create `pnpm-workspace.yaml`
- [x] Create root `package.json` with workspace scripts
- [x] Create `turbo.json`
- [x] Create `.nvmrc` (as `.n`)
- [x] Create `docker-compose.yml`

### 0.2 Create shared package skeletons

- [x] All 9 packages created (tsconfig, eslint-config, config, contracts, db,
      money, i18n, ui, api-client)

### 0.3 Create app skeletons

- [x] `apps/api` — NestJS 11 with Fastify adapter, empty composition root,
      core/platform/modules directories
- [x] `apps/web` — Next.js 15 App Router with Tailwind, next-intl ([locale]
      routing), TanStack Query setup

### 0.4 Set up quality tooling

- [x] **ESLint** flat config
- [x] **Prettier**
- [x] **Husky + lint-staged + commitlint**
- [x] **Vitest** workspace config — 7 projects with coverage thresholds
- [x] **dependency-cruiser**

### 0.5 Set up CI/CD

- [x] GitHub Actions workflow
- [x] Dependabot config
- [x] gitleaks config
- [x] Docker multi-stage build

### 0.6 Create `.env.example`

- [x] Exhaustive — all 32 env vars

### 0.7 Write the first architecture test

- [x] 7 architecture tests covering all boundary rules

---

## Phase 1 — Detailed progress

### 1.1 Database foundation (`core/database`)

- [x] Drizzle provider — `modubiz_app` role, `NOBYPASSRLS`
- [x] `TransactionManager` — `set_config(..., true)` for session-local RLS
      binding
- [x] Repository base — injects ambient transaction, no manual `organizationId`
      filters
- [x] `UnitOfWork` — collects domain events, publishes after commit
- [x] Migration runner stub

### 1.2 Tenancy (`core/tenancy`)

- [x] `TenantContext` — `AsyncLocalStorage` with
      `{ userId, organizationId, roles, permissions, locale }`
- [x] Tenant interceptor — binds context from authenticated session
- [x] `@SystemContext()` decorator — exempts routes from tenant context
- [x] `withoutTenantContext()` helper for testing fail-closed behaviour

### 1.3 Auth (`core/auth`)

- [x] `PasswordService` — argon2id with 64MB memory, 3 iterations, 4 threads
- [x] `JwtTokenService` — access (15min) + refresh (30d) tokens with rotation
- [x] `InMemorySessionStore` — refresh token hash index, family revocation
- [x] `JwtAccessStrategy` — Passport JWT strategy
- [x] Token rotation — reuse detection revokes entire family (`AUTH-4`)

### 1.4 Authorization (`core/authorization`)

- [x] CASL ability factory — builds from `TenantContext.roles` + `permissions`
- [x] `@RequiresPermission(key)` decorator + guard
- [x] `@RequiresModule(key)` decorator + guard (runs before permission)
- [x] `@PublicRoute()` decorator
- [x] `JwtAuthGuard` — global guard integrates with CASL

### 1.5 Entitlements (`core/entitlements`)

- [x] `EntitlementService` — state machine for module lifecycle
- [x] States: `available`/`suspended`/`disabled` ⇒ denied; `expired` ⇒
      read-only; `trialing`/`active`/`past_due` ⇒ full
- [x] 32 unit tests covering all state transitions

### 1.6 Events (`core/events`)

- [x] `EventBus` interface + `EventEmitter2` adapter (in-process)
- [x] `@OnDomainEvent(eventName)` typed listener decorator
- [x] Transactional outbox stub (`core_outbox` table pattern)
- [x] Publish-after-commit guarantee (events never published inside the
      transaction)

### 1.7 Money (`packages/money`)

- [x] `Money` value object — `bigint` minor units + ISO 4217 currency
- [x] Operations: `of`, `zero`, `add`, `subtract`, `multiply`, `allocate`,
      `convertTo`, `isNegative`, `toJSON`
- [x] Currency registry — exponents per currency (JPY 0, USD 2, KWD 3)
- [x] Rounding — half-up, applied once at boundary
- [x] `CurrencyMismatchError` — adding different currencies throws
- [x] 16 property-based tests with fast-check

### 1.8 i18n (`core/i18n` + `packages/i18n`)

- [x] Locale service — resolution order: explicit → user → org → Accept-Language
      → `en`
- [x] Direction service — `dir` derived from locale
- [x] Formatters — date, time, number, currency with locale + timezone
- [x] Catalogs — `en`, `ar`, `fr`, `es` with platform keys

### 1.9 Audit (`core/audit`)

- [x] `AuditLogger` — append-only, 13 entry types
- [x] `AuditInterceptor` — captures create/update/delete with before/after state
- [x] Redaction — 19 sensitive field patterns, recursive with depth limit
- [x] Query API — filter by actor, entity, action, date range

### 1.10 Observability (`core/observability`)

- [x] Pino logger — structured JSON with `correlationId` + `organizationId` +
      `userId` + `module`
- [x] Correlation ID middleware — assigns/propagates on every request
- [x] OpenTelemetry tracing setup + OTLP exporter
- [x] Prometheus metrics endpoint
- [x] Sentry error tracking integration

### 1.11 Cache, Jobs, Storage, Notifications

- [x] **Cache** (`core/cache`) — Redis `ioredis`, tenant-namespaced keys
      `org:<orgId>:<module>:<...>`
- [x] **Jobs** (`core/jobs`) — BullMQ queue registration, payloads carry
      `organizationId`
- [x] **Storage** (`core/storage`) — R2 presigned upload/download
- [x] **Notifications** (`core/notifications`) — in-app + email dispatch,
      idempotent

### 1.12 Common (`core/common`)

- [x] Error model — `AppError` hierarchy: `DomainError` (422), `NotFoundError`
      (404), `ConflictError` (409), `ForbiddenError` (403), `ValidationError`
      (400)
- [x] Global error filter — maps errors to
      `{ error: { code, params, correlationId, details } }`
- [x] Base DTOs — pagination, filtering, sorting
- [x] Interceptors — response envelope `{ data, meta }`

### Integration tests (Testcontainers)

- [x] **TEN-1** — RLS `WITH CHECK` rejects cross-org inserts
- [x] **TEN-3** — no tenant context ⇒ zero rows (read/update/delete)
- [x] **AUTH-2** — argon2id hashing with random salt
- [x] **AUTH-4** — token rotation with reuse family revocation
- [x] **AUTH-8** — consistent error responses
- [x] **OPS-3** — after-commit event guarantee (committed events observed;
      rolled-back never)

### Coverage improvement (targeted edge-case tests)

- [x] `jwt-token.service.ts` — 5 TTL parsing edge cases (empty, invalid, s, m,
      h)
- [x] `session-store.ts` — 11 new tests (missing session, revokeFamily mixed
      state, old-hash persistence)
- [x] `audit-logger.ts` — 5 new tests (depth limit, array items, null/undefined,
      primitive arrays)
- [x] `auth/` branches: **72.88% → 86.76%** (+13.88pp)
- [x] `audit-logger.ts` branches: **90.9% → 95.74%** (+4.84pp)

### Phase 2 — Coverage improvement (new test files)

- [x] `query-audit-log.use-case.spec.ts` — 8 tests covering pagination,
      actor/entity/action/date-range filters, null field handling
- [x] `get-fx-rate.use-case.spec.ts` — 9 tests covering **CUR-6**
      (prior-snapshot fallback, currency validation, rate-not-found)
- [x] `snapshot-fx-rates.use-case.spec.ts` — 7 tests covering pair generation,
      self-pair skip, single-currency edge cases
- [x] **Total: 994 tests, 48 files, all passing** (`npx vitest run`)
- [x] Quality gates: `pnpm typecheck` passes, `pnpm test:arch` 0 errors, API
      lint clean (only pre-existing web lint issues)

### Phase 2 — Definition of Done

| #   | Criterion                                                                               | Status                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All core platform migrations applied; RLS on every tenant table                         | ✅ Migrations 0001–0012 + RLS policies                                                                                                                   |
| 2   | Signup → org creation → login → token refresh flow works end-to-end                     | ✅ Integration + E2E green                                                                                                                               |
| 3   | **AUTH-2** through **AUTH-10** tested                                                   | ✅ AUTH-2/3/4/5/6/7/8/9 unit+integration; AUTH-10 via org-creation (integration)                                                                         |
| 4   | **AUTHZ-1** through **AUTHZ-9** tested                                                  | ✅ AUTHZ-1/2/3/4/7/8/9 unit+integration; AUTHZ-5/6 core-level tested                                                                                     |
| 5   | **BILL-1** through **BILL-13** tested (with Stripe fake)                                | ✅ BILL-1–10 unit-tested (six use cases + entity state machine); BILL-13 needs integration; BILL-11/12 deferred (Stripe-level, not in FakeStripeAdapter) |
| 6   | **CUR-1**, **CUR-6** tested                                                             | ✅ Unit-tested (update-org CUR-1 immutability, FX prior-snapshot CUR-6)                                                                                  |
| 7   | **GDPR-2** tested                                                                       | ✅ Use case implemented (delete/cancel-deletion); integration covered in organizations suite                                                             |
| 8   | Module registry boots; `GET /me/navigation` works                                       | ✅ Unit- and integration-tested                                                                                                                          |
| 9   | Frontend shell renders in `en` and `ar` (RTL); no hardcoded strings; no directional CSS | ✅ Verified; logical CSS throughout; RTL snapshot tests                                                                                                  |
| 10  | **E2E smoke**: signup → org → invite member → switch locale                             | ✅ `invitation-flow.e2e.spec.ts` green (signup → org → invite → signup locked email → accept)                                                            |
| 11  | Coverage: `core/` ≥ 90%, platform ≥ 90% line                                            | ⚠️ Core thresholds enforced by vitest projects; platform coverage not separately gated                                                                   |
| 12  | Architecture tests green: `platform/` imports only `core/` + `contracts`                | ✅ 0 errors (pre-existing orphan warnings)                                                                                                               |

### Phase 1 — Definition of Done

| #   | Criterion                                                                                               | Status                            |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | `core/database` — TransactionManager with RLS binding; TEN-1, TEN-3 proven                              | ✅ Integration tests pass         |
| 2   | `core/tenancy` — TenantContext + middleware; TEN-2 tested                                               | ✅ 27 unit tests pass             |
| 3   | `core/auth` — JWT + refresh rotation + sessions; AUTH-2, AUTH-4, AUTH-8 tested                          | ✅ 42 unit + 21 integration tests |
| 4   | `core/authorization` — CASL + guards; AUTHZ-5, AUTHZ-6 tested                                           | ✅ 42 tests pass                  |
| 5   | `core/entitlements` — state machine; all transitions tested                                             | ✅ 32 tests pass                  |
| 6   | `core/events` — EventBus + outbox; after-commit proof and OPS-2 idempotency tested                      | ✅ 20 unit + 3 integration tests  |
| 7   | `packages/money` — full Money VO; CUR-4, CUR-7, CUR-8, CUR-9 property-tested                            | ✅ 16 fast-check tests pass       |
| 8   | `core/i18n` + `packages/i18n` — locale resolution + formatters; I18N-1, I18N-4, I18N-7 tested           | ✅ 27 tests pass                  |
| 9   | `core/audit` — append-only logger; AUD-1, AUD-2, AUD-3 tested                                           | ✅ 29 tests pass                  |
| 10  | `core/observability` — Pino + correlation id + OTEL + Sentry                                            | ✅ 25 tests pass                  |
| 11  | `core/cache`, `core/jobs`, `core/storage`, `core/notifications` — TEN-6, TEN-7, NOTIF-1, NOTIF-3 tested | ✅ 62 tests pass                  |
| 12  | `core/common` — error model + global filter; ERR-5, ERR-6 tested                                        | ✅ 47 tests pass                  |
| 13  | Coverage: `core/` ≥ 90% line / 85% branch                                                               | ✅ All thresholds met (exit 0)    |
| 14  | Architecture tests green: core/ imports nothing from platform/ or modules/                              | ✅ 7/7 arch tests pass            |
| 15  | `process.env` only read in `packages/config` (architecture test)                                        | ✅ Enforced by arch test          |

---

## Phase 6 — Detailed progress

### 6.1–6.6 + 6.9 Backend (contracts → scaffold → schema → domain → application → API → isolation)

- [x] **6.1 Contracts** — `pos.sale.completed.v1` / `pos.sale.refunded.v1` /
      `pos.shift.opened.v1` / `pos.shift.closed.v1` event schemas
      (`POS_EVENTS`), `signedMinorUnitsString` primitive (shift variance),
      `RestockInput` added to `INVENTORY_STOCK_PORT` (POS-22 return/write_off)
- [x] **6.2 Scaffold** — `pnpm generate:module pos` (28 files, auto-registered);
      removed the stale inline POS descriptor duplicated in
      `registered-modules.ts`
- [x] **6.3 Schema** — `0001_init.sql` (8 tables), `0002_rls.sql` (FORCE RLS on
      every table), `0003_append_only.sql` (`pos_payments` trigger); POS-2
      partial-unique open shift, POS-9 unique org+register+receipt, POS-16
      non-negative total check, POS-26 unique org+idempotency_key
- [x] **6.4 Domain** — Register (POS-1), Shift (POS-2/3/5/6/7), Sale
      (POS-10/11/12/13/14/16/17/19), Refund (POS-20/21/22/23); exact bigint
      money helpers + `sumDecimalQuantities`/`decimalQuantityExceeds`; 26 unit
      tests (incl. POS-2/10/11/16/17/21/22)
- [x] **6.5 Application** — Create/ListRegister, Open/CloseShift, Checkout
      (POS-3/9/15/26), VoidSale (POS-14), ProcessRefund (POS-20→24), Sync
      (POS-26/27/28/29), List/GetSale, ListShifts, GetShiftReport;
      `DrizzlePosRepository`; 12 integration tests
- [x] **6.6 API** — `v1/pos/*` controller with `@RequiresModule` +
      `@RequiresPermission`, UUID `Idempotency-Key` header validation (POS-26),
      `status`/`shiftId` filter validation, org base currency via read port
- [x] **6.9 Isolation** — `pos.isolation.spec.ts` **11/11**: TEN-1 cross-org
      register read / open-shift / checkout / list denials + sale read + lists,
      TEN-2 injected `organizationId` ignored, TEN-3 no-context zero rows,
      AUTHZ-6 `MODULE_NOT_ENTITLED`, AUTHZ-5 permission denial

**Reviewer fixes applied (Session 64):** POS-28 multi-line stock-leak (rejected
syncs now throw OUT of the transaction so earlier lines' reservations roll back;
the `rejected` sync-log row is written in its own transaction; only genuine
stock rejections are classified `rejected` — regression test added); POS-21
per-line quantity cap now normalizes decimal scales before comparing;
`Idempotency-Key` header + sales filters validated at the API layer.

**Validation:** contracts 1544/1544 · API unit 1544/1544 (incl. POS 26) · POS
integration 12/12 · isolation 35/35 (incl. POS 11) · lint 0 errors · arch 0
errors · API/web typechecks clean.

---

## Session log

### Session 68 — E2E Journeys verified on a real GitHub runner (workflow_dispatch)

- **Pushed + dispatched.** The POS/journeys/CI work landed on `main` as three
  commits (`feat(pos)` full stack, `test(web)` journeys + seeder, `ci(ci)`
  workflow), then `workflow_dispatch` runs exercised the real runner path.
- **Run 1 — web build failed on a fresh checkout.** `pnpm --filter web build`
  alone breaks: `src/i18n/request.ts` imports
  `@modubiz/i18n/messages/{en,ar,fr,es}` from the package's built `dist/`
  (exports map), which doesn't exist until the workspace packages are compiled.
  The job now runs `pnpm build` (turbo builds `^build` deps first — same as
  ci.yml's Build stage).
- **Run 2 — readiness poll could never pass.** The poll used `curl -f` on
  `/v1/modules`, which is auth-gated and returns 401 without a token — `-f`
  treats 401 as an error, so the check always failed even though the API was up
  and routing. Now mirrors Playwright's own webServer readiness semantics (same
  URL): any HTTP response (401 included) means routing; only 000 (no connection)
  is not ready.
- **Runs 3–4 — no browser binaries.** Added the Playwright install step, but a
  root-level `npx playwright` fails with "playwright: not found" (the binary
  ships via `@playwright/test` inside apps/web only) — resolved through
  `pnpm --filter web exec playwright install --with-deps chromium`.
- **Run 5 — GREEN.** All 16 steps pass: containers → deps → role-before-migrate
  bootstrap → workspace build → dev servers → seed (fresh user/org/trials) →
  journeys: CRM 7.6s, Inventory 8.6s, POS 12.4s (3 passed, 31.3s total).
  Artifact upload skipped (nothing to upload).

### Session 67 — Journey specs wired into CI (nightly + on demand)

- **`.github/workflows/e2e-journeys.yml`.** New workflow with a nightly cron
  (02:17 UTC) + `workflow_dispatch` so the full journey suite runs against a
  REAL browser + REAL API + a FRESH Postgres. Postgres and Redis run as GitHub
  service containers; the runner installs `postgresql-client` for the role
  bootstrap step.
- **Fresh-DB bootstrap proven against a throwaway container.** Migrating a
  pristine database surfaced an ordering bug the local stack had hidden: core
  migration `0003_rls.sql` grants RLS policies **to `modubiz_app`**, so the role
  must exist _before_ `pnpm db:migrate`. The workflow now creates the role
  first, migrates as `modubiz_owner`, then grants `ALL TABLES/SEQUENCES` +
  `ALTER DEFAULT PRIVILEGES` (mirroring `docker/postgres/init/init.sql`).
  Verified end-to-end on postgres:16-alpine: app-role reads tenant tables
  fail-closed (0 rows), global tables readable.
- **`.env` materialization.** The API dev server runs `--env-file ../../.env`
  and the config schema refuses to boot with missing keys, so the job copies
  `.env.example` and appends CI overrides (DB URLs → service container,
  placeholder secrets — inert: signup/org/trial are DB-only).
- **Dev servers start before seeding.** `pnpm e2e:seed` calls the API directly,
  so the job boots `api` + `web` in the background, polls `/v1/modules` + `/en`
  until ready, then seeds and runs `pnpm test:e2e:journeys` (Playwright reuses
  the running servers).
- **Failure artifacts.** On failure it uploads Playwright `test-results/`,
  `playwright-report/`, and the api/web dev-server logs.
- **Docs.** TESTING.md §8 documents the nightly workflow and the
  role-before-migrate bootstrap; PROGRESS.md header updated.

### Session 66 — POS journey confirmed + committed E2E seeder (journey specs runnable on demand)

- **POS journey confirmed.** `pos-journey.e2e.spec.ts` was written but never
  executed (it self-skips without a seeded env). Seeded a real session through
  the API (signup → org USD → inventory trial → POS trial → Playwright
  storageState) and ran it: **passes, twice in a row** against the persistent
  dev DB. Fixed three stale selectors the run surfaced: (1) combobox triggers
  are named by their field label ("Product"/"Selling warehouse"), not the
  placeholder text; (2) checkout now clicks the register row's "New sale" link
  (`?registerId=`) instead of a bare `/checkout` visit, which on a re-run
  preselected the FIRST (previous run's, shift-closed) register; (3) `Low stock`
  badge assertion needed `exact: true` (collides with the "Low stock only"
  filter toggle) — inventory journey, same fix.
- **Committed E2E seeder.** `scripts/seed-e2e-env.mjs` — signup → login → org →
  switch-org → enable trials **dependency-first from the live catalog** (BILL-8;
  defaults to crm+inventory+pos, `--modules` to narrow) → writes the gitignored
  `apps/web/e2e/.e2e-state.json` storageState. Re-runnable (fresh user + org per
  run). `apps/web/playwright.journey.config.ts` injects the storageState +
  defaults `E2E_BASE_URL` so the specs' skip guard passes; `testMatch` limits it
  to `*-journey` specs (invitation-flow still runs its own signed-out flow).
  Root + web scripts: `pnpm e2e:seed` and `pnpm test:e2e:journeys`.
- **CRM journey fixed to pass too** (it runs under the same config): the CRM
  `Field` component had no `htmlFor`/id label associations (getByLabel would
  never resolve), the contact select gained `id="deal-contact"` (previously the
  spec fell back to a fragile `getByRole('combobox').first()` that hit the
  sidebar search), the "Deals" subnav link is targeted via `getByLabel('CRM')`
  (strict-mode: two "Deals" links), and the final assertion moved to the deals
  TABLE view — the board's default "today" date filter hides deals created near
  the UTC midnight boundary. Contact/deal names stamped so the journey is
  re-runnable.
- **Validation.** `pnpm e2e:seed && pnpm test:e2e:journeys` **3/3 twice** (CRM
  3–4s · inventory 4–5s · POS 6–8s); default `pnpm test:e2e` still skips the
  journeys (CI-safe); web typecheck + lint clean on all touched files; docs
  updated (TESTING.md §7 running-locally note).

### Session 65 — Phase 6.7 POS frontend (register/shift mgmt + checkout + refund, no PWA)

- **API bindings.** POS section in `lib/api/resources.ts` — registers, shifts,
  shift reports, sales (paged + status filter), checkout (with `Idempotency-Key`
  header, POS-26), void, refunds; typed against the real controller mappers
  (money envelopes, `PosSaleLine`/`PosPayment` row shapes).
- **Checkout UI** (`/m/pos/checkout`). Register combobox (URL preselect from the
  registers page's "New sale" row action), sellable-variant picker fed by the
  full products catalog (`pageSize: 100`, priced in the org base currency per
  POS-11), cart with exact BigInt line totals + 4-decimal quantity stepping,
  cash/card/other payment with tendered/change math, open-shift guard (POS-3),
  and a reused idempotency key rotated after success (POS-26).
- **Registers** (`/m/pos`). Create-register form (warehouse combobox),
  open/close shift forms with row preselect, status badges, variance summary on
  close (POS-4/5/8), permission-gated actions.
- **Shifts + reports.** Shifts list (`/m/pos/shifts`) with open/closed filter
  and member-name resolution; shift report (`/m/pos/shifts/[id]`) with
  sales/refunds/net totals + expected-vs-counted variance + per-sale links.
- **Sales + refunds.** Sales list (`/m/pos/reports`) with status filter and
  pagination; sale detail (`/m/pos/sales/[id]`) with lines/payments tables, void
  (POS-14, ConfirmDialog), and the refund dialog (POS-20..24) — per-line
  quantity with client-side POS-21 cap + re-proration, restock toggle, reason,
  register defaulting to the sale's own register.
- **i18n.** Full `modules.pos` block (register/checkout/shifts/report/reports/
  sale/refund/errors/select/list) added to **en/ar/fr/es** + `pos-completeness`
  parity spec; a code→catalog audit over every `t('…')` found no missing keys.
- **Tests.** POS money math + error-mapping units (7); web **201/201**; i18n
  **1547/1547**; web typecheck clean; lint 0 errors (line/complexity warnings
  match the existing inventory-view baseline). Reviewer fixes applied: exact
  4-decimal quantity stepping (no float math), refund default register + cap,
  `usePosCatalog` key under the shared `['inventory']` scope, and the
  `Idempotency-Key` header merge verified safe in `apiFetch`.
- **Deferred.** Offline PWA parts (service worker, IndexedDB outbox, POS-25/27)
  per the scope decision.

### Session 64 — Phase 6 POS backend: contracts → schema → domain → application → API → isolation

- **Contracts (6.1).** `pos.sale.completed.v1`, `pos.sale.refunded.v1`,
  `pos.shift.opened.v1`, `pos.shift.closed.v1` payload schemas with the shared
  money block (minor-units strings + currency, POS-11) and
  `signedMinorUnitsString` primitive for the shift variance (POS-5). Added
  `RestockInput` to `INVENTORY_STOCK_PORT` and implemented `restock` in the
  inventory port impl (POS-22: `return` vs `write_off` movement, same
  transaction).
- **Scaffold + schema (6.2/6.3).** Generated the module, removed a stale inline
  POS descriptor that duplicated the imported one in `registered-modules.ts`,
  and wrote the 8-table schema with RLS on every table and the POS-2/9/16/26
  constraints. `pos_payments` is append-only (POS-13).
- **Domain (6.4).** `Register` (POS-1), `Shift` (POS-2/3/5/6/7), `Sale`
  (POS-10/11/12/13/14/16/17/19 — line snapshots, per-line tax in bp, payments =
  total, void rules), `Refund` (POS-20/21/22/23 — per-line restock, reason
  code). Exact bigint money helpers; 26 unit tests.
- **Application (6.5).** 13 use cases incl. the critical `CheckoutUseCase`
  (allocates the receipt atomically, deducts stock via the Level 3 port in the
  SAME transaction — POS-15 — and publishes the event after commit).
  `ProcessRefundUseCase` allows successive partial refunds with cumulative caps.
  `SyncOfflineSaleUseCase` is idempotent (POS-26), server-assigns the receipt
  (POS-27), and records every attempt (POS-29). 12 integration tests incl. a
  multi-line rejected-sync regression proving earlier lines' stock effects roll
  back.
- **API (6.6).** `v1/pos/*` controller: registers, shifts
  (open/close/list/report), sales (checkout/sync/list/get/void), refunds;
  guards + permissions per route; org base currency resolved through
  `ORGANIZATION_READ_PORT`; UUID `Idempotency-Key` header validation.
- **E2E journey (6.7).** `pos-journey.e2e.spec.ts` mirrors the inventory journey
  (self-skips without a seeded env): create product → receive stock (lazily
  creates the default warehouse) → create register → open shift → checkout a
  $25 cash sale → full refund → close the shift asserting the
  POS-5 expected-cash math (float 0 + sales 2500 − refunds 2500 = $0
  expected, zero variance). Registers-view row actions gained register-name
  aria-labels (`register.openFor`/`closeFor`) so E2E can target a row while the
  form-submit keeps the plain "Open shift"/"Close shift" accessible name; the
  checkout tendered input gained an aria-label for `getByLabel`.
- **Isolation (6.9).** 11/11 cases against a real Postgres Testcontainer.
- **Reviewer fixes.** Applied all review findings: the POS-28 partial stock leak
  (HIGH), the POS-21 decimal-scale cap (MEDIUM), the over-broad sync catch
  (MEDIUM), and the header/filter validation (LOW).

### Session 63 — Inventory/audit UI fixes: warehouse form labels, missing i18n key, audit actor names

- **Warehouse create form label.** The warehouse name field used
  `t('fields.name')`, which is the product-scoped key **"Product name"** — so
  the "Add warehouse" form read as a product form. Switched it to
  `warehouses.tableName` ("Name"). The submit button/header already used
  `warehouses.create` ("Add warehouse") — a stale dev build can show older
  labels until the dev server restarts.
- **Missing i18n key.** `fields.code` (used by the warehouse form + warehouse
  detail) was absent from all four catalogs — next-intl rendered the raw key
  path. Added `code` to the inventory `fields` block in en/ar/fr/es. Ran a
  code→catalog audit over every `t('…')` in the inventory feature + pages:
  `fields.code` was the only genuinely missing key (the rest were URL-state
  `searchParams.get(...)` false positives). Note: the existing
  `inventory-completeness` spec only checks locale parity, so a key missing from
  all four locales slips through — flagged as a follow-up.
- **Audit log actor names.** The settings audit page showed raw actor user ids.
  It now resolves them through the shared `useMemberName` hook (members cache):
  current members see their name, removed users fall back to the id (the record
  keeps the immutable id), and system entries keep "System". Standard practice —
  audit logs store actor ids for integrity; UIs resolve names at render time.
- **Tests.** Web **184/184** — the audit-page spec gained a `useMemberName` mock
  (the shared react-query mock returned a non-array for the members query) and
  now asserts the name column renders "Owner" for `user-1`. i18n parity **2/2**.
  Web typecheck + lint clean (0 errors).

### Session 62 — Inventory audit stamps: product/variant "Created by / Last edited by"

- **Backend stamps.** `createdByUserId`/`updatedByUserId` added to
  `ProductVariantData` (optional, so create/add use cases are untouched),
  `ProductRow` (required), `findProductById` SELECT, and `rowToVariant` (the
  columns already existed in `inv_products`/`inv_product_variants` and were
  already stamped by create/archive/update). `GetProductUseCase` and the
  `productDetailResponseSchema`/`productVariantResponseSchema` DTOs surface them
  (nullable — legacy rows may predate stamps).
- **Audit-accuracy fix (reviewer-caught).** `updateVariantCost` — the INV-12
  moving-average cost write on receipts — advanced `updated_at` without stamping
  `updated_by`, which would have made "Last edited by" misleading after the
  first receipt. It now stamps `updated_by` from the tenant context (the
  receiving user, matching the movement's `created_by`); the INV-2/INV-12
  integration test asserts the flip.
- **Shared `useMemberName` hook.** The CRM-local `useMemberName`/`useOrgMembers`
  moved to `apps/web/src/lib/hooks/use-member-name.ts` (members query key
  `['members', organizationId]` unchanged) and CRM's `hooks.ts` now re-exports
  them — so inventory renders stamps without importing CRM feature code. CRM's
  `useCurrencies`/`useFxRate`/`useOrgBaseCurrency` untouched.
- **Frontend.** `InventoryVariant` + product-detail types in `resources.ts`
  gained the stamp fields; the product detail view shows "Created by / Last
  edited by" on the product card (via `DetailField`) and a per-variant stamp
  line (spans + `·` separator, RTL-safe), names resolved from the shared members
  cache with `—` fallback for removed members.
- **i18n.** `detail.createdBy`/`detail.updatedBy` added to en/ar/fr/es (CRM
  translations reused); parity green.
- **Tests.** Integration **28/28** — get-product asserts create stamps on the
  product + variant; update-variant asserts a second user's edit flips
  `updatedByUserId` while `createdByUserId` stays. API unit **1461/1461** ·
  isolation **13/13** · web **184/184** · arch 0 errors · typechecks + lint
  clean. Code-reviewed (stamp fix + RTL nit applied).

### Session 61 — Inventory archive-404 fix + product/variant edit functionality

- **Archive bug (the 404).** The products list called
  `POST /v1/inventory/products/{id}/archive` with a **product** id, but
  `ArchiveProductUseCase` did `findVariantById(id)` — a variant lookup — so a
  product id always missed and threw `VARIANT_NOT_FOUND` (404). Rewrote it as a
  true product-level archive: archives every non-deleted variant of the product
  in one transaction and emits a single `inventory.product.archived.v1` event
  carrying all `variantIds` (skips the event when the product has no active
  variants left). The INV-11 integration test now archives by product id and
  asserts **all** variants flip `is_active = false` while keeping
  `deleted_at = NULL` (soft delete, history preserved).
- **Edit functionality — backend.** `ProductVariant.updateDetails()` domain
  method (validates price/cost currency consistency, updates updatedAt);
  `updateProduct`/`updateVariant` repo methods (field-set SQL, no write when
  nothing changed); new `UpdateProductUseCase` (name/description) and
  `UpdateVariantUseCase` (sku/barcode/price/cost/reorder) with an **INV-10
  self-excluding duplicate-SKU check** (org-wide uniqueness that ignores the
  variant being edited); `PATCH /v1/inventory/products/:id` and
  `PATCH /v1/inventory/variants/:id` routes with `@Audit` UPDATE decorators +
  update DTOs; both use cases registered in the module + exported.
- **Domain copy fix (real bug found while testing).**
  `ProductVariant.fromPersistence()` returned the entity _sharing the same
  object_ as the DB row, so `updateDetails()` mutated the row object in place —
  the "SKU changed?" comparison saw the new SKU and the INV-10 branch silently
  never fired. `fromPersistence` now copies the data (matching `create`); a
  regression unit test locks the copy semantics in.
- **Edit functionality — frontend.** `updateInventoryProduct` /
  `updateInventoryVariant` API bindings; `updateProduct`/`updateVariant`
  mutations in hooks (variant mutation invalidates the right product-detail
  key); `ProductForm`/`VariantForm` gained `initialValues`, `existingSkus`, and
  `submitLabel` props for prefilled edit mode; the products list row menu gained
  an **Edit** action that fetches the product detail on demand and opens the
  prefilled form; the product detail view gained a header **Edit** button and a
  per-variant **Edit** button with a prefilled variant form.
- **i18n.** `products.edit/updatedMessage`, `variants.edit/updatedMessage` added
  to **en/ar/fr/es**; parity spec green.
- **Tests.** Integration **28/28** (new: archive-product by productId archives
  all variants, update-product, update-variant happy path + INV-10 duplicate
  rejection); API unit **1459/1459** (updateDetails + fromPersistence copy
  regression); isolation **13/13** (new TEN-1 cross-org denial for
  update-product and update-variant); web **26/26**; arch **8/8**; API + web
  typechecks and lint clean. Code-reviewed (empty-archive event guard + TEN-1
  coverage for the update use cases applied); PROGRESS.md updated.

### Session 58 — Inventory frontend upgrade: spec + product detail, variants, warehouses, counts, reservations

- **Spec.** Wrote
  [docs/INVENTORY_FRONTEND_SPEC.md](./docs/INVENTORY_FRONTEND_SPEC.md) — the
  full professional frontend spec (pages, flows, filters, i18n, backend gaps).
  User scoped the build to **full stack, product detail + variants first**.
- **Backend additions (additive, no schema changes).** `get-product` (product +
  variants + per-warehouse stock + ledger history), `add-variant` (INV-10
  org-wide duplicate SKU), `archive-variant` (INV-11 soft delete, one variant),
  `create-warehouse` (INV `WAREHOUSE_DUPLICATE_CODE`, `isDefault` honoured
  once), `list-reservations`, `get-stock-count` (+ enriched lines), plus
  controller routes, response DTOs, and the two new descriptor nav items
  (stock-counts, reservations) with icons.
- **Frontend.** `product-detail-view` (variant management — add/archive with
  `Can` guard, per-warehouse stock, movements), `warehouse-detail-view`
  (composed from list + stock rows), `reservations-view`, `stock-count-detail`
  (lines with variance, apply), create-warehouse form on the warehouses page,
  stock sub-nav (movements/transfers/reservations), product/warehouse/count
  links from the list pages, 4 new route pages, hooks + API bindings,
  `sumQuantities` exact decimal helper (no JS floats on quantities),
  duplicate-code/not-found error mappings.
- **i18n.** New `detail`, `variants`, `reservations` sections + warehouse/
  counts/stock/nav keys + 2 error keys in **en/ar/fr/es**; parity spec green.
- **Tests.** 7 new integration cases (get-product, add-variant happy +
  cross-product duplicate SKU, archive-variant, create-warehouse dup code,
  list-reservations, get-stock-count) — integration suite now **21/21**; unit
  31, isolation 11, web 26, arch 8, i18n 2 — all green; lint 0 errors.

### Session 59 — Phase 5.10 inventory list filter/pagination UI (spec §5.6/5.7/5.11)

- **URL-driven list views.** New `features/inventory/table-shared.tsx` —
  `useInventoryListUrlState` (debounced `q`, `page`, generic `update` that
  resets to page 1 on filter changes — the CRM pattern) + `InventoryPagination`
  (previous/next + `{count} items` + `Page {page} of {pages}`, RTL chevrons).
  Every filter lives in the URL so views are shareable and the back button
  behaves.
- **Stock page** — search (name/SKU), warehouse select, **low-stock chip**
  (`aria-pressed` toggle, INV-13 available ≤ reorder), reset button when any
  filter is active; calls the paged `useInventoryStock` with
  `search`/`warehouseId`/`lowStock` + `page`/`pageSize`, pagination footer.
- **Movements page** — search, movement-type select (8 types), from/to date
  inputs (ISO `YYYY-MM-DD`, inclusive), reset; paged `useInventoryMovements`
  - pagination. Toolbar extracted into `MovementsToolbar` (view complexity was
    22 > 10).
- **Reservations page** — status select (held/committed/released/expired,
  sanitized by a type guard), paged `useInventoryReservations` + pagination.
  Search intentionally omitted (the endpoint has no `search` filter) — noted in
  a comment. Toolbar extracted into `StockToolbar` too.
- **i18n** — `inventory.list.*` (total/pageOf/previous/next/resetFilters) +
  stock/movements/reservations filter labels in **en/ar/fr/es**; parity spec
  green.
- **Validation** — web typecheck clean, lint 0 errors, web **26/26**, i18n
  **2/2**. Reviewer feedback applied (toolbar extraction + search-omission
  comment); no functional issues.

### Session 60 — Phase 5.10 products + stock-counts list filters (spec §3)

- **Products list** — `GET /v1/inventory/products` gained `search` (name/SKU)
  and `status` (`active`/`archived`) + paged envelope. `listProducts` rewritten
  with `DISTINCT ON (p.id)`: `is_active` is now derived via
  `EXISTS(active variant)` (INV-10/11), and the variant JOIN includes archived
  variants so an archived product still displays its last SKU/price (history
  never lost). Display variant prefers the most recent ACTIVE variant, falling
  back to the most recent archived. Controller validates `status` allow-list +
  `page`; DTO envelope gains `total/page/pageSize`.
- **Stock-counts list** — `GET /v1/inventory/stock-counts` gained `status`
  (`draft`/`applied`) + paged envelope; `listStockCounts` now COUNT +
  LIMIT/OFFSET, still returning `lines` per count. `apply`/`create` stock-count
  use cases switched from full-list scans to `findStockCountById`.
- **Frontend** — products view: search + active/archived select + reset +
  pagination; stock-counts view: draft/applied status select + reset +
  pagination. Both use the shared `useInventoryListUrlState` /
  `InventoryPagination`. The count form's variant picker fetches `pageSize: 100`
  (full catalog, not page 1). Hooks gained `productsKey` / `stockCountsKey`
  flattened keys + `keepPreviousData`.
- **i18n** — `products.searchPlaceholder/filterStatus/allStatuses` and
  `counts.filterStatus/allStatuses` added to **en/ar/fr/es**; parity green.
- **Tests** — integration **26/26** (new: products search/status/pagination
  INV-10/11, counts status/pagination INV-14), unit **31/31**, isolation
  **11/11**, web **26/26**, arch **8/8**; API + web typecheck and lint 0 errors.
  Reviewer feedback applied: active-first display ordering + full-catalog count
  picker (both were real edge cases).

### Session 58 — Phase 5.10 inventory backend list filters + pagination (spec §3)

- **Paged + filtered reads.** `GET /v1/inventory/stock` gained `search`,
  `warehouseId`, `lowStock`; `/stock/movements` gained `search`, `type`,
  `fromDate`, `toDate`; `/reservations` gained `status`. All three now return a
  paged envelope `{ items, total, page, pageSize }` (CRM pattern: COUNT +
  LIMIT/OFFSET, pageSize clamped 1–100, default 12). Query params are validated
  in the controller (UUID / ISO-date / movement-type / reservation-state /
  positive-int page) so malformed input is a 400, never a 500.
- **Port + repo.** `PageResult<T>` + `StockLevelListFilter` /
  `MovementListFilter` / `ReservationListFilter` in the repository port;
  `listStockLevels` / `listMovements` / `listReservations` signatures changed to
  `(filter, tx)`. New `all` flag on stock/movement filters for internal batch
  reads — the low-stock alert job (INV-13), reconciliation job (INV-2), and
  product-detail composition now pass `{ all: true }` so they can never be
  silently truncated by the 12-row default (reviewer-caught regression).
- **Web bindings.** `getInventoryStock/Movements/Reservations` take filter
  params and return the paged shape; hooks use flattened query keys +
  `keepPreviousData` (CRM pattern). Views render the same — the toolbar/paging
  UI is the remaining frontend step.
- **Tests.** Integration **24/24** (3 new: stock search/warehouse/low-stock +
  pagination + `all`, movements search/type/date + pagination, reservations
  status + pagination); unit **31/31** (jobs.spec mocks updated to the paged
  shape); isolation **11/11**; web **26/26**; arch **8/8**. API + web typechecks
  and lint clean.

### Session 57 — Phase 5.9 inventory isolation tests + Phase 5 marked complete

- **Isolation suite (5.9).** `inventory.isolation.spec.ts` grew from the
  generator placeholder to the full required-case set — **11/11 passing**
  against a real Postgres Testcontainer with RLS active: TEN-1 cross-org denial
  for variant read, stock update, archive, product list, ledger views, warehouse
  list, and stock-count list; TEN-2 injected `organizationId` in the create
  input is ignored (row lands in the session org); TEN-3 no-context ⇒ zero rows;
  AUTHZ-6 OWNER gets `MODULE_NOT_ENTITLED` when inventory is disabled; AUTHZ-5
  permission denial (no `inventory:product:read`).
- **INV-1 enforcement test (DoD gap closed).** The append-only trigger existed
  in `0003_append_only.sql` but no test proved UPDATE/DELETE were blocked —
  added a case to the integration suite asserting both fail with the trigger's
  error and the ledger row is untouched. Integration suite now **14/14**.
- **Docs.** PLAN.md Phase 5 DoD fully checked (5.8/5.9 marked done, incl. the
  Phase 3.4 `TransactionRef`-minting note for the 5.6 core touch — same
  justification as Phase 4's `DrizzleEntitlementStore` note); PROGRESS.md
  header + phase table moved to Phase 5 ✅ / Phase 6 next; added the Phase 5
  detailed-progress section and this session entry; also fixed a pre-existing
  formatting bug where the Phase 4 status row had merged into the Phase 3 row.

### Session 56 — Phase 5.8 inventory frontend + web build fix + scratch cleanup

- **Frontend (5.8).** Finished the in-flight backend support (`listMovements`
  repo method, `GET /v1/inventory/stock/movements` route + DTOs, unit-cost
  fields on stock levels; fixed the pre-existing circular import in
  `packages/contracts/events/inventory.ts`), then built the web half: inventory
  bindings in `lib/api/resources.ts`, self-contained `features/inventory/`
  (BigInt money helpers, schemas, hooks, forms, 6 views), low-stock +
  stock-valuation dashboard widgets wired into the dashboard, `m/inventory/*`
  routes, and the full `modules.inventory.*` key set in en/ar/fr/es with a
  parity test. Tests: widget i18n regression, money units, E2E journey spec
  (self-skips without a seeded env). Web **184/184**, API **1446/1446**,
  inventory integration 13/13, arch 0 errors. Review found and fixed an
  error-key namespace mismatch that would have broken every error banner.
- **Next.js build fix (pre-existing).** `next build` failed during `/404`
  prerender with `<Html> should not be imported outside of pages/_document` —
  caused by the ambient `NODE_ENV=development` on this machine (known Next.js
  bug: the production switch is skipped when `NODE_ENV` is already set). Fixed
  with a dependency-free wrapper `apps/web/scripts/next-build.cjs` that forces
  `NODE_ENV=production` before spawning `next build`; `web build` now exits 0
  with the full route table (inventory pages included). CI + turbo route through
  the package script, so both are covered.
- **Scratch cleanup.** Deleted `apps/api/repro-company-insert.mjs`,
  `repro-sql.mjs`, and the empty `results.sarif` (gitleaks output, 0 findings) —
  API lint back to **0 errors**.

### Session 55 — Phase 4 CRM complete: grouped sidebar navigation, Arabic module name, commit + push

- **Sidebar module dropdowns.** The Modules section of the sidebar now groups
  each module's links under a collapsible parent instead of one flat list — CRM
  → Contacts / Companies / Deals / Activities, Inventory → Products / Warehouses
  / Stock. The parent row carries the module icon, name, and a rotating chevron
  (`aria-expanded`); the module owning the active route auto-expands on
  navigation while manual collapses elsewhere are preserved. Child links indent
  with `ms-6` (RTL-safe) and keep per-page icons from a `NAV_ICONS` map
  (descriptor icon strings → Lucide, module icon fallback); the collapsed rail
  still flattens every page to an icon-only shortcut with a tooltip. New
  `sidebar.test.tsx` covers nesting/toggle, auto-expand on a child route
  (`/m/crm/deals/table`), and the collapsed rail (3 cases).
- **Activities added to the CRM descriptor navigation.** The sidebar never
  showed an Activities link (the descriptor only declared contacts/companies/
  deals while the CRM page tabs include activities). Added
  `{ labelKey: 'modules.crm.nav.activities', href: '/m/crm/activities', icon: 'activity' }`
  to `crm.descriptor.ts` — `GetNavigationUseCase` reads descriptors directly, so
  the sidebar (and any navigation consumer) picks it up with no migration.
- **Arabic module name translated.** `modules.crm.name` was the raw acronym
  `'CRM'` in Arabic; translated to `إدارة علاقات العملاء` so the sidebar
  dropdown parent, marketplace, and dashboard cards localize.
- **Pre-commit lint baselines cleared.** `git commit` runs lint-staged over
  staged files; the commit was blocked by 7 errors in two tracked-to-be files:
  the five `CompanyDetailView` address `as`-casts in details.tsx (replaced with
  a typed `addressField` string-guard helper) and the two hooks.ts baselines
  (`relatedId!` → `relatedId ?? ''` since `enabled` gates the query; the
  notes-list `invalidateQueries` → `void …`). The staged-file lint dry-run is
  now 0 errors.
- **Phase 4 marked done.** PLAN.md Phase 4 DoD checklist fully checked; the
  phase table and header moved to Phase 5. The commit also includes the
  accumulated uncommitted platform work from earlier sessions (most notably the
  DB-backed `DrizzleEntitlementStore` swap — the deferred Phase 1.6→2
  infrastructure completion, not a module change). `repro-company-insert.mjs` (a
  leftover local debug script) was left untracked.
- **Validation.** API **1360/1360** · web **168/168** (incl. 3 new sidebar
  cases + i18n parity) · i18n completeness 1/1 · typechecks clean · staged- file
  lint 0 errors · Prettier clean · arch 0 errors. Code-reviewed.

### Session 54 — Phase 4 CRM UX: translated close label, stage-history movers, activity card layout

- **`modules.crm.common.close` translated.** The nested `modules.crm.common`
  block only carried `loading`/`empty`/`none`/`cancel`, yet `MoveDealDialog`
  reads `common.close` for its dismiss-button aria-label — next-intl fell back
  to the raw key path. Added `close` to all four locales (en/ar/fr/es); also
  added the sibling `system` key that `NotesSection` already referenced for its
  author fallback, so neither key can surface raw anymore.
- **Stage history shows the mover.** Each entry in the deal detail stage history
  now appends the user who made the move: the API already returned `movedBy` per
  `crm_deal_stage_history` row (and the web `CrmStageHistoryEntry` type already
  carried it) — the view just never rendered it. The date/duration line now
  reads `… · by {name}` via the new `detail.movedBy` key (en/ar/fr/es),
  resolving names through the shared `useMemberName` hook so removed members
  still show, with `common.system` as the fallback.
- **Activity cards reorganized.** In the activities list, the related-entity
  chip (contact / company / deal name, with the deal-stage badge) moved from the
  lower row up to sit between the type badge and the subject, so every card
  reads Type → Related → Subject. The lower row now always shows an ownership
  chip: `User` + member name when assigned, and a matching `UserX` +
  "Unassigned" chip (`activities.unassigned`) when not — consistent row rhythm
  instead of the chip silently disappearing.
- **Validation.** web **165/165** (i18n parity) · i18n completeness spec 1/1 ·
  web typecheck clean · Prettier clean · lint clean on changed lines (only the
  pre-existing details.tsx company-address `as` casts remain). Code-reviewed;
  PROGRESS.md updated.

### Session 53 — Phase 4 CRM UX: per-column pipeline date filters, column value totals, and a deals table view

- **Board per-column date filters.** The global From/To date range on the Deals
  page is gone. Each pipeline column now has its own Range dropdown — **Today**
  (default) / **This week** (rolling 7 days) / **This month** / **All time** —
  filtering on `updated_at` (deals touched in the period, per the user's pick).
  Each column queries the API separately
  (`GET /v1/crm/deals?stageId=…&fromDate=…&toDate=…`) via a new `useDealsBoard`
  hook (`useQueries`, one query per stage), so counts and totals are exact per
  column; the result array aligns with the pipeline stages and the board merges
  the cards for drag-and-drop + the ⋮ stage menu.
- **"All time" opens the table view.** Picking All time in a column navigates to
  the new table page pre-filtered to that stage (`/m/crm/deals/table?stage=…`)
  instead of loading every deal onto the board. A "Showing X of Y deals" note
  still appears under a column when the 100-row clamp hides rows
  (`deals.shownCount`).
- **Column total value.** Each column header shows the exact value of its deals
  summed in the **org base currency** — computed server-side
  (`SUM(CASE WHEN base_amount_minor IS NULL THEN value_amount_minor ELSE base_amount_minor END)`,
  since a base-currency deal stores `base_amount_minor = NULL`) and independent
  of the page-size clamp. `listDeals` returns `totalValueBaseMinor` on the page
  envelope; the board formats it with the org base currency + exponent.
- **New deals table view (`/m/crm/deals/table`).** A Board/Table toggle (present
  on both views) leads to a sortable, filterable list: search (title), Stage,
  Status (open/won/lost), and From/To updated-date inputs; sorting by Title /
  Value (org-base) / Updated via sortable headers (`sortBy`/`sortDir`,
  server-side); pagination; and a footer with the filtered count + total value
  (`deals.tableSummary`). Every filter lives in the URL (`q`, `stage`, `status`,
  `from`, `to`, `sortBy`, `sortDir`, `page`) so views are shareable; the search
  input is debounced 300ms.
- **API.** `DealListFilter` gained `stageId`, `status`, `sortBy`
  (`updatedAt|createdAt|title|value`), `sortDir`; `listDeals` sorts via an
  allow-listed ORDER BY (never client SQL), returns `createdAt`/
  `updatedAt`/`baseAmountMinor` per row (new typed `DealListRow`), and the
  controller validates every new query param (400 before the use case).
  `DealListEnvelopeResponse` gained `totalValueBaseMinor`; `dealResponseSchema`
  gained the optional timestamps.
- **i18n.** `deals.viewBoard`, `viewTable`, `dateFilter`, `filterToday`,
  `filterThisWeek`, `filterThisMonth`, `filterAllTime`, `columnTotal`,
  `statusFilter`, `allStatuses`, `allStages`, `open`, `won`, `lost`,
  `tableTitle`, `tableStage`, `tableContact`, `tableValue`, `tableStatus`,
  `tableUpdated`, `tableSummary`, `resetFilters` added to en/ar/fr/es.
- **Tests.** Controller spec: malformed `stageId`, unknown `status`, unknown
  `sortBy`, malformed `sortDir` → 400 before the use case. CRM integration:
  per-stage filter with exact `totalValueBaseMinor` across base-currency and
  FX-converted deals, and `sortBy: title` / `sortBy: value` orderings.
- **Validation.** API **1360/1360** · web **165/165** (i18n parity) · CRM
  integration **24/24** · arch 0 errors · API + web typecheck clean · Prettier
  clean · lint clean on changed lines (pre-existing baselines only: hooks.ts
  non-null assertion + floating promise) · OpenAPI + api-client regenerated
  (`stageId`/`status`/`sortBy`/`sortDir`, `totalValueBaseMinor`, row
  timestamps). Code-reviewed; PROGRESS.md updated.

### Session 52 — Phase 4 CRM UX: audit stamps on contact/company/activity details

- **Companies now stamp `created_by`/`updated_by`.** Previously only
  contacts/deals/activities recorded these (via their domain entities) — company
  rows never stamped them at all. `CreateCompanyUseCase` /
  `UpdateCompanyUseCase` now read `TenantContext.getUserId()` and pass
  `createdByUserId`/`updatedByUserId` through `insertCompany`/`updateCompany`
  (both RETURNING the columns; `updated_by` uses a `CASE WHEN` guard so a
  partial update only overwrites when supplied). `CrmCompanyRecord` port +
  `toCompany` map the stamps — only when the query selected the columns, so list
  rows omit them rather than claim null (code review).
- **Detail reads surface the stamps.** `findContactById` / `findCompanyById` /
  `findActivityById` now SELECT `created_by, updated_by` and return
  `createdByUserId`/`updatedByUserId`; the contact/activity/company response
  schemas gained the optional fields (OpenAPI + api-client regenerated).
- **Frontend.** `CrmContactDetail` / `CrmCompanyDetail` / `CrmActivityDetail`
  gained the stamp fields; a new shared `useMemberName` hook (wraps the members
  cache) resolves display names from ALL members — removed members still show on
  records they created/edited. Created by / Last edited by fields added to the
  contact, company, and activity detail cards, and the deal view refactored onto
  the shared hook (removing its inline resolver).
- **Tests.** Integration case covers audit-stamp round trips for all three
  entities: contact (domain-stamped), company (use-case-stamped, detail returns
  both), and activity (domain-stamped).
- **Validation.** API **1356/1356** · web **156/156** · CRM integration
  **22/22** · arch **8/8** · root typecheck 7/7 · Prettier clean · lint clean on
  changed lines (pre-existing baselines only) · OpenAPI + api-client
  regenerated. Code-reviewed (conditional stamp mapping + `CASE WHEN` guard
  applied); PROGRESS.md updated.

### Session 51 — Phase 4 CRM UX: deal activities, related chips, edit-form assignee, deal audit stamps

- **Create activity from the deal detail page.** `DealDetailView` gained a
  related-activities card with a "New activity" toggle — `ActivityForm`
  pre-links the activity to the deal (`relatedType: 'deal'`, `relatedId`), and
  the card lists existing deal-related activities with due badges.
- **Activities list shows the related entity + deal stage.** `listActivities`
  now LEFT JOINs `crm_contacts` / `crm_companies` / `crm_deals` /
  `crm_pipeline_stages` (each guarded by `related_type` AND
  `deleted_at IS NULL`) to resolve `relatedName` (contact full name / company
  name / deal title) plus `dealStageId` + `dealStageNameI18n` for deal-linked
  rows; all conditions were qualified with the `a.` alias. Each activity row
  renders a related-entity chip deep-linking to its detail page, with a stage
  badge for deals. `activityResponseSchema` gained the three optional fields
  (OpenAPI + api-client regenerated).
- **Assignee moved into the activity edit form.** The inline assignee Select on
  the activity detail row is gone — the edit form (type/subject/assignee) now
  owns reassignment: `startEdit` seeds the current assignee, `submitEdit` sends
  `assignedToUserId` only on a real change (`''` unassigns, CRM-14 enforced),
  and the Save button stays disabled until something changed. The row now shows
  the assignee name plainly (removed members still resolve).
- **Deal created-by / edited-by.** `findDealById` now returns `createdByUserId`
  / `updatedByUserId` from the existing `created_by` / `updated_by` columns;
  `DealDetailView` shows "Created by" and "Last edited by" fields with member
  names resolved from all members.
- **i18n.** `detail.createdBy`, `detail.updatedBy` added to en/ar/fr/es.
- **Tests.** Two new integration cases: related-name/stage resolution across
  contact/company/deal/unlinked activities (deal rows carry a localized stage
  map, solo rows null), and deal audit stamps — created/updated both the
  creating user, a stage move by a different user flips `updatedBy` while
  `createdBy` stays.
- **Validation.** API **1356/1356** · web **156/156** (i18n parity) · CRM
  integration **21/21** · arch **8/8** · root typecheck 7/7 · Prettier clean ·
  lint clean on changed lines (pre-existing baselines only: `listDeals`
  no-base-to-string, details.tsx address casts + complexity, hooks.ts) ·
  OpenAPI + api-client regenerated. Code-reviewed (soft-delete guards on the
  JOINs + safe related-href lookup applied); PROGRESS.md updated.

### Session 50 — Phase 4 CRM UX: company detail deals show stage + value

- **Company detail deal rows now match the contact detail.** Each related deal
  on the company page renders a pipeline-stage `Badge` (resolved from the cached
  default pipeline, localized, missing stage degrades to a dash) next to the
  value formatted via `formatMinorAmount` — replacing the raw
  `amountMinor currency` text that was previously shown.
- **DRY: shared `stageName` helper.** The change made the stage-name lookup
  threefold duplicated (contact, company, deal detail). Hoisted a module-level
  `stageName(pipeline, stageId, locale)` helper in `details.tsx` and updated all
  six call sites in the three views (per code review).
- **Validation.** web typecheck clean · web **156/156** · Prettier clean · lint
  clean on changed lines (only the pre-existing company-address `as` casts +
  max-lines/complexity baselines remain). Code-reviewed (DRY helper applied);
  PROGRESS.md updated.

### Session 49 — Phase 4 CRM UX: "Unassigned" quick-filter chip

- **Header chip.** The CRM workspace header now shows an "Unassigned" toggle
  button (UserX icon) next to "Assigned to me" on the activities view. It
  toggles the same `activityAssignee` state the dropdown uses — click once to
  filter to unassigned activities, click again to clear to "All assignees" — and
  resets to page 1. `aria-pressed` + `secondary` variant show the active state;
  the two chips share a small `toggleActivityAssignee` helper (code review DRY
  suggestion). No new i18n — reuses `activities.unassigned`.
- **Validation.** web typecheck clean · web **156/156** · Prettier clean · lint
  0 errors (pre-existing warnings only). Code-reviewed (helper applied);
  PROGRESS.md updated.

### Session 48 — Phase 4 CRM UX: activities unassigned + status filters

- **"Unassigned" assignee filter.** The activities Assignee dropdown gained an
  "Unassigned" option (web sentinel `ACTIVITY_ASSIGNEE_UNASSIGNED` mapping to
  `GET /v1/crm/activities?unassigned=true`). `ActivityListFilter` gained
  `unassigned?: boolean`; the repository narrows with `assigned_to IS NULL` (RLS
  keeps it tenant-local); the controller validates the `true`/`false` shape and
  returns 400 on anything else, mirroring the date/UUID params.
- **Completion status filter.** A new Status dropdown (All / Open / Completed)
  drives `?completed=true|false`: `completed=true` → `completed_at IS NOT NULL`,
  `false` → `IS NULL`, absent → both. The filter combines freely with the
  assignee/date filters (e.g. Unassigned + Open shows only the still-open
  unassigned tasks).
- **Frontend plumbing.** `CrmListParams`/`toQueryString` and the `activitiesKey`
  cache key carry `unassigned`/`completed` so each filter state keeps its own
  cache. Both dropdowns reset to page 1 on change. The "Assigned to me" header
  toggle still overrides the sentinel cleanly.
- **i18n.** `activities.unassigned`, `statusFilter`, `allStatuses`, `open` added
  to en/ar/fr/es (reusing the existing `activities.completed` key).
- **Tests.** Controller spec covers malformed `unassigned`/`completed` → 400
  before the use case runs; integration test covers unassigned-only, open-only,
  completed-only, Unassigned+Open combined, and unfiltered.
- **Validation.** API **1356/1356** (2 new controller cases) · web **156/156**
  (i18n parity) · CRM integration **19/19** · arch **8/8** · root typecheck 7/7
  · Prettier clean · lint clean on changed lines (pre-existing baselines only) ·
  OpenAPI + api-client regenerated (`unassigned`/`completed` on the activities
  endpoint). Code-reviewed (no blockers).

### Session 42 — Phase 4 CRM UX: activity detail page, extend due date, activity notes, unfiltered activities list

- **Activity detail page.** Added `GET /v1/crm/activities/:id`
  (`findActivityById` on the read repository + fail-closed `GetActivityUseCase`
  `ACTIVITY_NOT_FOUND`), a web `ActivityDetailView` at `m/crm/activities/[id]`,
  and the `useCrmActivityDetail` hook. The page shows type, status (`DueBadge`),
  due/completed/created/updated, a deep link to the related
  contact/company/deal, a Complete button, and the shared notes section.
  Activity rows in the list and on the contact detail now link to it.
- **Extend due date.** New `PATCH /v1/crm/activities/:id`
  (`updateActivitySchema` with ISO `dueAt`), `UpdateActivityUseCase` (CRM-13: a
  completed activity rejects the update with
  `CRM_ACTIVITY_COMPLETED_IMMUTABLE`), and an inline `datetime-local` + Save
  control on the detail page gated by `crm:activity:write`; the error maps to a
  localized message.
- **Notes on activities.** The shared `NotesSection` accepts
  `relatedType="activity"` and renders on the activity detail page (notes are
  already supported end-to-end by `crm_notes` + the notes API).
- **Activities list default now unfiltered.**
  `activityFromDate`/`activityToDate` start empty (was today); the reset button
  clears the range (new `activities.clearDates` key) instead of restoring today.
  Undated activities were already always visible.
- **Tests.** API controller metadata covers GET `:id` (read) and PATCH `:id`
  (write + audit); CRM integration 17/17 (new getById round-trip, NOT_FOUND
  fail-closed, due-date extension, completed-activity rejection).
- **Validation.** API unit **1352/1352** · web **156/156** (i18n parity) · CRM
  integration **17/17** · root typecheck 7/7 · Prettier clean · lint clean on
  changed files (pre-existing full-project baseline unchanged) · OpenAPI +
  api-client regenerated (`/v1/crm/activities/{id}` GET+PATCH).

### Session 47 — Phase 4 CRM UX: "Assigned to me" quick-filter badge

- **One-click shortcut in the workspace header.** The CRM workspace header now
  shows an "Assigned to me" toggle button (with the `User` icon) on the
  activities view. Clicking it flips the same `activityAssignee` state the
  section dropdown controls: `''` (all assignees) → current user id, and back.
  It resets pagination to page 1 and carries `aria-pressed`; the active state
  uses the `secondary` variant so it reads as a pressed filter chip rather than
  the adjacent primary "Add activity" button (code-review tweak). The button and
  the dropdown stay in sync since they share one state, and the existing
  `activities.assignedToMe` key is reused (no new i18n).
- **Validation.** Web typecheck clean · web **156/156** · Prettier clean · lint
  0 errors (pre-existing warning baseline only).

### Session 46 — Phase 4 CRM UX: assignee filter on the activities list

- **Backend — `assigneeUserId` filter on `GET /v1/crm/activities`.**
  `ActivityListFilter` gained `assigneeUserId`; `listActivities` narrows with
  `assigned_to = ?` (RLS keeps the query tenant-local — this is a client-visible
  narrowing, never a tenant bypass). The controller validates the UUID shape
  (400 on malformed, mirroring the date params) and passes it through. The use
  case needed no change (filter object passes through).
- **Frontend — assignee dropdown in the activities workspace.**
  `CrmListParams`/`toQueryString` and `activitiesKey` carry `assigneeUserId`
  (caches stay separate per filter). `ActivitiesSection` gained an Assignee
  `Select`: **All assignees** (default), **Assigned to me** (current user id
  from the session), then each active member (minus self, so no duplicate).
  Changing it resets to page 1. Active members come from the shared
  `useOrgMembers` cache.
- **i18n.** `activities.assigneeFilter`, `activities.allAssignees`,
  `activities.assignedToMe` added to en/ar/fr/es.
- **Tests.** Controller spec: malformed `assigneeUserId` returns 400 before the
  use case is reached. Integration: filtering narrows to the assignee's
  activities, the unfiltered list shows both, and an assignee with no activities
  returns an empty page (not an error).
- **Validation.** API unit **1354/1354** · web **156/156** · CRM integration
  **18/18** · arch **8/8** · root typecheck 7/7 · Prettier clean · lint clean on
  changed lines (pre-existing hooks.ts baseline unchanged) · OpenAPI +
  api-client regenerated (`assigneeUserId` on the activities endpoint).

### Session 45 — Phase 4 CRM UX: assignee chip on activities list rows

- **Assignee chip in the activities workspace.** Each `ActivityList` row now
  renders a small `Badge` chip (`User` icon + member name) next to the due badge
  when the activity is assigned, resolving the name via the existing
  `useOrgMembers` hook (shares the `['members', organizationId]` cache — no
  duplicate fetch). The chip is omitted when the assignee can't be resolved
  (e.g. they've since left the org), consistent with the detail page's `—`
  fallback — no raw UUIDs in the UI (code-review fix).
- **Validation.** Web typecheck clean · web **156/156** · Prettier clean · lint
  clean on changed lines (pre-existing hooks.ts baseline unchanged).

### Session 44 — Phase 4 CRM UX: reassign activities from the detail page

- **PATCH /v1/crm/activities/:id now reassigns too.** `updateActivitySchema`
  gained `assignedToUserId` (uuid, nullable — null unassigns);
  `UpdateActivityUseCase` forwards it and calls the domain `Activity.assignTo()`
  with the org's active-member set, so CRM-14 (assignee must be an active
  member) and CRM-13 (completed activities immutable, reassignment included) are
  enforced in the domain exactly as on create. The controller resolves
  `activeMemberIds` via the membership read port when a non-null assignee is
  provided (mirrors create; unassigning needs no set).
- **Inline reassign control on the detail row.** The activity details card's
  Assignee field is now a `Select` (gated by `crm:activity:write`, hidden when
  the activity is completed) that fires the PATCH directly on change — active
  members only, plus the current assignee if they've since left the org so the
  select always shows the real value. Names resolve from the FULL members list
  (a removed member still shows on activities they were assigned to). New
  `useOrgMembers` hook shares the `['members', organizationId]` cache key with
  the members settings page (no duplicate fetch).
- **i18n.** `fields.assignee` added to en/ar/fr/es. The existing
  `errors.activityAssigneeInvalid` key already mapped
  `CRM_ACTIVITY_ASSIGNEE_NOT_ACTIVE_MEMBER` to a localized message.
- **Tests.** Controller spec DTO validation covers valid uuid / null assignee
  and rejects a malformed one; the CRM integration suite's CRM-13 case now also
  assigns to an active member (seeded membership), rejects a non-member
  (`CRM_ACTIVITY_ASSIGNEE_NOT_ACTIVE_MEMBER`), unassigns via null, and asserts
  reassignment of a completed activity is rejected alongside the other edits.
- **Validation.** API unit **1353/1353** · web **156/156** · CRM integration
  **17/17** · arch **8/8** · root typecheck 7/7 · Prettier clean · lint clean on
  changed lines (pre-existing baseline unchanged) · OpenAPI + api-client
  regenerated (`UpdateActivityDto` now carries `assignedToUserId`).

### Session 43 — Phase 4 CRM UX: edit activity subject/type on the detail page

- **PATCH /v1/crm/activities/:id now edits more than the due date.**
  `updateActivitySchema` accepts optional `type` (enum) and `subject` (trimmed,
  1–200) alongside `dueAt` — a strict partial update. `UpdateActivityDto` and
  `UpdateActivityUseCase` forward them; the domain `Activity.update()` already
  supported type/subject, so no entity change was needed. The controller passes
  through only the fields the client provided.
- **Detail-page edit form.** `ActivityDetailView` gained an Edit button (gated
  by `Can permission="crm:activity:write"`, hidden once completed) that swaps
  the details card into an inline form with a type `Select` and a subject
  `Input`. Save is disabled when the subject is blank or nothing changed; Cancel
  exits. Uses a `const ACTIVITY_TYPES` tuple with a `.find()` guard instead of
  an `as` cast (lint).
- **Frontend typing.** `CrmActivityUpdate` (`type?/subject?/dueAt?`) replaces
  the inline `{ dueAt? }` on `updateCrmActivity` and the `useCrmMutations`
  `updateActivity` mutation.
- **Tests.** Controller spec gained an `updateActivitySchema` validation case
  (subject/type/dueAt partials valid, blank subject/unknown type/unknown keys
  rejected); the CRM integration suite's CRM-13 case now also changes
  subject+type (untouched due date preserved) and asserts that _every_ edit —
  due date, subject, or type — is rejected once the activity is completed.
- **Validation.** API unit **1353/1353** (new DTO test) · web **156/156** · CRM
  integration **17/17** · arch **8/8** · root typecheck 7/7 · Prettier clean ·
  lint clean on changed lines (pre-existing baseline unchanged) · OpenAPI +
  api-client regenerated (`UpdateActivityDto` carries type/subject/dueAt).

### Session 41 — Phase 4 CRM UX: company/contact address, notes, deals date filter cleared

- **Backend — Notes API**: added `listByRelated` to `NoteRepository` (LEFT JOINs
  `core_users` for author name), a `NotesController` with `POST /v1/crm/notes`
  (create) and `GET /v1/crm/notes/:relatedType/:relatedId` (list), Zod DTOs, and
  wired into `CrmModule`.
- **Contact form**: added `companyId` select field (resolves company names from
  the cached companies list).
- **Contact card**: shows a `Badge variant="outline"` with the company name when
  `companyId` is set.
- **Company form**: added structured address fields (street, city, state,
  postalCode, country) inside a `<fieldset>` on the add form.
- **Notes section**: shared `NotesSection` component on contact/company/deal
  detail pages — add note via inline input + Send button, list with author name
  (resolved from `core_users`) and timestamp.
- **Deals page**: removed the default today date-range filter
  (`fromDate`/`toDate` now start empty; reset button clears to empty, not
  today). Activity date filter still defaults to today.
- **Company detail**: added `NotesSection` and kept address display clean
  (filters out null/empty entries).
- **i18n**: added `clearDates`, `notes.*`, `address*` field keys to en/ar/fr/es.
- **Validation**: web 156/156 · API 1351/1351 · typechecks clean · OpenAPI +
  api-client regenerated.

### Session 40 — Phase 4 CRM UX: deal stage on contact detail, activity due

badges, activities due-date filter

- **Contact detail deals show their stage.** Related deals on the contact page
  now render a stage `Badge` resolved from the fetched pipeline (`stages`
  lookup, missing stage gracefully shows a dash) alongside the formatted value —
  no extra API surface needed.
- **Activity due-state badges (`DueBadge`).** New `features/crm/due-badge.tsx`
  computes a calendar-day diff from the due date and renders a localized badge:
  completed (secondary) → due today → upcoming "N days left" (outline) → overdue
  "N days ago" (destructive). It is rendered in the activities list, the contact
  detail related-activities rows, and the activity detail date line.
  Calendar-day math via `startOfDay` diff with `Math.round` (DST-safe);
  unit-tested (6 cases).
- **Activities page date-range filter on `due_at`, defaulting to today.**
  `ActivityListFilter` gained `fromDate`/`toDate` (inclusive day range via
  `::date` bounds); the activities view has From/To inputs + "Reset to today",
  mirroring the deals page. `activitiesKey` includes the range so caches stay
  separate.
- **Undated activities stay visible (from review).** `due_at` is nullable, so a
  silent date-filtered drop would hide undated tasks from the default "today"
  view. The `due_at` range conditions are wrapped in `OR due_at IS NULL`, and
  the integration test asserts an undated activity still appears under a past
  range.
- **Input hardening (mirrors deals).** The activities controller validates the
  `YYYY-MM-DD` shape of both params and returns 400 BAD_REQUEST instead of a
  500; new controller tests cover both.
- **i18n.** `dueToday`, `overdue`, `overdueDays`, `daysLeft`, `completed`,
  `fromDate`, `toDate`, `resetDates` added to en/ar/fr/es (ICU plurals for day
  counts).
- **Validation.** API tests **1351/1351** (2 new controller cases) · CRM
  integration **16/16** (new due-date filter test incl. undated visibility) ·
  web **156/156** (6 new DueBadge cases + i18n parity) · root typecheck 7/7 ·
  lint 0 errors · Prettier clean · OpenAPI + api-client regenerated
  (`fromDate`/`toDate` on the activities endpoint).

### Session 39 — Phase 4 CRM UX: board card names, updated-day filter, RTL

pagination arrows

- **Board cards now show contact + company names.** `listDeals` LEFT JOINs
  `crm_contacts` and `crm_companies` to resolve `contactName` ("First Last") and
  `companyName`, rendered as a muted "Ada Lovelace · Acme Co" line on each card.
  Names are also optional-nullable fields on `dealResponseSchema`, so
  detail/create/move responses stay backward-compatible.
- **Date-range filter on `updated_at`, defaulting to today.** `DealListFilter`
  gained `fromDate`/`toDate` (inclusive day range via `::date` bounds); the
  Deals page has From/To date inputs that start at today (local timezone) with a
  "Reset to today" button. `dealsKey` includes the range so caches stay
  separate; `useCrmData` still fetches the broad 100-row page for detail views.
- **RTL pagination arrows fixed.** The shared `Pagination` component's chevrons
  now carry `rtl:rotate-180`, so Previous/Next point correctly in Arabic
  (inline-start/end) — this fixes Contacts, Companies, and Activities lists.
- **Malformed-date hardening (from review).** `fromDate`/`toDate` are
  interpolated into `::date` casts, so the controller now validates the
  `YYYY-MM-DD` shape and returns 400 BAD_REQUEST instead of a 500. New
  controller tests cover both params; the stale cache-sharing comment in
  hooks.ts was corrected.
- **Validation.** API tests **1349/1349** (2 new controller cases) · CRM
  integration **15/15** (new names + date-range test: joined contact/company
  names, today's deals matched, past range empty) · web **150/150** · root
  typecheck 7/7 · lint 0 errors · Prettier clean · OpenAPI + api-client
  regenerated (`fromDate`/`contactName` present in spec and client).

### Session 38 — Phase 4 CRM UX: compact ⋮ stage menu on board cards

- **Full-width stage select replaced on board cards.** Each deal card now has a
  compact ⋮ ghost button in its header row (next to the status badge) that opens
  a stage-list menu. The drag-and-drop flow, the MoveDealDialog for lost stages,
  and the detail-page stage changer are unchanged.
- **New `StageMenu` component (`features/crm/stage-menu.tsx`).** The board
  columns scroll internally (`overflow-y-auto`), which would clip an in-card
  absolute dropdown, so the menu portals to `document.body` with fixed
  positioning anchored to the trigger. It flips above the trigger when there is
  no room below, clamps to the viewport, and mirrors to the right edge in RTL
  (`dir=rtl`).
- **Menu behaviour.** Current stage is check-marked and carries `aria-current`;
  lost stages are styled destructive with a localized "Lost" hint. Click or
  Enter/Space selects, ArrowUp/Down + Home/End navigate, Escape or an outside
  pointerdown closes, and the menu also closes on column scroll/resize so it
  never floats detached from its card. Focus moves into the menu on open and
  returns to the ⋮ trigger on select/Escape. If `disabled` flips true while open
  (permission lost, move in flight), the menu closes.
- **Permission gating preserved.** The ⋮ button is wrapped in
  `Can permission="crm:deal:write"` and is `disabled` while a move is pending;
  selecting a lost stage still routes through `requestMove` → MoveDealDialog, so
  CRM-7 (lost reason required) is unchanged.
- **Tests.** New `stage-menu.test.tsx` (8 cases): trigger semantics, open +
  current-stage check, lost hint, select + close, keyboard select (ArrowDown +
  Enter), Escape close, outside-pointerdown close, and disabled no-open. Full
  web suite **150/150**, web typecheck clean, lint 0 errors (existing warning
  baseline only), Prettier clean, code-reviewed (aria-current +
  disabled-while-open hardening applied).

### Session 37 — Phase 4 CRM UX: deals board + detail page rework

- **Board pagination removed, columns scroll internally.** The pipeline board
  now fetches all deals up to the API's 100-row clamp (`pageSize: 100`, which
  now shares the `useCrmData` query key/cache when no search is active) and each
  stage column scrolls within `max-h-[calc(100vh-260px)]` — long columns never
  stretch the page. A `deals.shownCount` note appears when the clamp actually
  hides rows.
- **Stage changer everywhere.** Board cards and the deal detail page both have a
  stage `Select` bound to the deal's current stage (fires only on a real change,
  permission-gated). Drag-and-drop still works and routes through the same move
  flow.
- **Lost-stage moves collect the mandatory reason in a proper dialog.** New
  `MoveDealDialog` (accessible modal: panel focus, Escape, hidden backdrop) asks
  for the lost-reason code when the target stage is lost (CRM-7) and disables
  confirm until a non-blank reason is typed — replacing the old `window.prompt`
  on drop and fixing the broken select-to-lost path that previously sent no
  reason at all. The board dialog stays open (showing a spinner) until the move
  mutation settles.
- **Deal detail page polish:** stage changer + MoveDealDialog wired to the move
  mutation, exponent-aware money via `formatMinorAmount`, contact and company
  render as links to their detail pages, an error banner, and a won/lost badge
  on board cards (dead `formatMoney` helper removed).
- **i18n:** `deals.moveToStage`, `deals.lostReasonPlaceholder`,
  `deals.lostReasonHint`, `deals.shownCount` added to en/ar/fr/es.
- **Validation:** web 142/142 (i18n parity), root typecheck 7/7, lint 0 errors,
  Prettier clean.

### Session 36 — Phase 4 CRM UX: deals + activities pagination

- **Deals and activities lists are now paginated and searchable**, mirroring the
  contacts/companies pattern: `listDeals`/`listActivities` return
  `{ items, total, page, pageSize }` with a title/subject ILIKE search, clamped
  page bounds, and stable ordering with an `id` tiebreaker (deals:
  `updated_at DESC`; activities: incomplete first, soonest due first).
- **Deals view** gained a search box and pagination controls around the pipeline
  board; **activities view** gained the same around its list.
  `PipelineBoard`/`ActivityList` render an empty state when a page is empty and
  the board keeps drag/drop + stage-select movement unchanged.
- **Detail views stay complete:** `useCrmData` fetches deals/activities at the
  API's 100-row clamp for related lists and form dropdowns, so the
  contact/company detail pages still see all related deals and activities while
  the workspace lists page at 12.
- **Tests:** API 1347/1347, CRM integration 14/14 (new deal and activity
  pagination + search cases), web 142/142 (i18n parity), root typecheck 7/7.
  OpenAPI + api-client regenerated.

### Session 35 — Phase 4 CRM UX: pagination, filtering, extended fields

- **Pagination + strong filtering on contacts/companies lists:** the CRM read
  port now returns `{ items, total, page, pageSize }` for contacts and companies
  with `search` (name/email/phone/domain ILIKE), `companyId` narrowing for
  contacts, and `updated_at DESC` ordering (most recently added/edited first,
  exactly as requested). Page bounds are clamped server-side (`page >= 1`,
  `pageSize` 1–100); the web list pages got prev/next controls, a result-count
  line, and keepPreviousData so filters and page turns stay smooth.
- **Contact form fields:** added `secondaryPhone` (new forward-only migration
  `0003_secondary_phone.sql`), `preferredLocale`, and `preferredCurrency` to
  create/update forms and the detail edit view. Both phone fields validate
  against the shared `PHONE_PATTERN` (`^\+?[\d\s().-]{5,30}$`) on the API DTOs
  and the frontend Zod schema — free-text numbers like `call me` are now
  rejected with a localized `errors.invalidPhone` message.
- **Contact detail page actions:** “New deal” (pre-linked to the contact,
  honoring its preferred currency) and “New activity” (pre-linked as
  `relatedType: contact`) open inline forms, wrapped in `Can` permission gates.
  Shared `Field`/`FormCard`/`DealForm`/`ActivityForm` were extracted into
  `features/crm/forms.tsx` for reuse between the workspace and detail views.
- **Contracts + events:** `secondaryPhone` added to contact identity in the
  `crm.contact.created/updated.v1` payloads as nullable+optional (backward
  compatible with previously published events). Fixtures updated.
- **Tests:** API 1347/1347, CRM integration 12/12 (new pagination, company
  filter, and secondaryPhone round-trip cases), isolation 8/8, contracts events
  92/92, web 142/142 (new phone-format and preference-field schema cases), root
  typecheck 7/7. OpenAPI + api-client regenerated; dev DB migrated with
  `secondary_phone`.

### Session 34 — Phase 4 runtime fix: seeded FX reference data

- **Root cause of deal-create 422 (`dealFxRateRequired`):** the org base
  currency is USD but `core_fx_rates` was empty — `core_currencies` (the
  snapshot job's source of pairs) was never seeded, so cross-currency deal
  creation (CRM-8/CUR-6) had no rate to snapshot and correctly failed.
- **`packages/db/src/seed.ts` implemented (was a stub):** seeds 11 ISO 4217
  reference currencies (idempotent, `ON CONFLICT DO NOTHING`) and all ordered
  mock FX pairs for today (110 rows) using the same deterministic formula as
  `SnapshotFxRatesUseCase`; skips pairs that already exist for the day.
- **CLI teardown fixed:** the seed now owns its postgres client and calls
  `client.end()` in `finally`, so `pnpm db:seed` exits cleanly instead of
  hanging on the open pool.
- **Workaround note:** drizzle `sql.join` multi-row VALUES produced a Postgres
  `syntax error at or near "$5"` with the postgres-js driver (`prepare: false`);
  per-row parameterized statements are used instead.
- **Regression test added:** `tests/integration/seed.integration.test.ts`
  (Testcontainers) asserts currencies seeded, pair count derived from the
  currency count (all ordered pairs minus self), EUR→USD present for today, and
  idempotency on re-run. Run against the real dev DB too (11 currencies, 110
  pairs, re-run skips).
- **Deal-form currency UX:** the free-text currency input (root of the earlier
  422 — users could type any code) is now a dropdown fed by the seeded
  `/v1/currencies` reference endpoint, defaulting to the org base currency
  (reuses the dashboard's cached org query) with a localized hint explaining
  cross-currency conversion. `deals.currencyHint` added to en/ar/fr/es.
- **Live base-currency preview in the deal form:** as the user types, the form
  fetches the pair rate via `GET /v1/fx-rates/:base/:quote` (404 → null) and
  shows the converted `base_amount_minor` in the org base currency, mirroring
  the backend `Money.convertTo` math exactly (bigint, 6-decimal scaled rate,
  truncating) via new pure helpers in `features/crm/money.ts` (unit-tested).
  Missing rates surface a localized unavailable message instead of a 422 after
  submit. `deals.previewAmount` and `deals.rateUnavailable` added to
  en/ar/fr/es.
- **Validation:** db `tsc -b` clean, root typecheck 7/7, Prettier clean,
  integration seed test 1/1, web tests 132/132 (i18n parity). `packages/db`
  remains outside the lint gate (no `eslint.config.js`/`lint` script; baseline
  matches `migrate.ts`).

### Session 33 — Phase 4 runtime fixes: CRM accessible from the frontend

- **Two independent blockers fixed so the CRM module actually works when reached
  from the web UI (reported 403s / silent trial failures).**
  1. **Role matrix granted no module permissions:** `SYSTEM_ROLE_PERMISSIONS`
     only carried `platform:*` permissions, so every `@RequiresPermission`
     (`crm:contact:read`, …) returned 403 even with entitlement — the
     PermissionGuard has no OWNER bypass. The matrix is now **derived from the
     registered descriptors** (`@modubiz/contracts` `ALL_PERMISSIONS`),
     classified read/write/config per BUSINESS_RULES §3 (VIEWER = read, MEMBER =
     read+write, MANAGER/ADMIN/OWNER = all). Adding a module no longer requires
     hand-editing the matrix.
  2. **Trial bootstrap:** orgs with no subscription got `SUBSCRIPTION_NOT_FOUND`
     on “Start free trial” (silently swallowed by the marketplace page).
     `EnableModuleTrialUseCase` now **lazily bootstraps the base subscription**
     inside the transaction (BILL-1 exactly one, BILL-2 trial needs no payment
     method), reading the org base currency via a new
     `BillingRepository.getOrganizationBaseCurrency()` (global table, no RLS).
     `FakeStripeAdapter.addSubscriptionItem` no longer 500s after a server
     restart.
  3. **EntitlementGuard read a stale in-memory store (the 403 after trial):**
     `EntitlementsModule` still provided the Phase 1.6
     `InMemoryEntitlementStore` stub while trials wrote to
     `core_module_entitlements` — so every guarded CRM endpoint returned
     `MODULE_NOT_ENTITLED` after restart. Replaced with a new
     `DrizzleEntitlementStore` (BILL-4: the DB is the runtime authority). It
     opens its own transaction per method and binds
     `app.current_organization_id` from the verified JWT claims, because guards
     run before the TenantInterceptor (TransactionManager.run is unavailable
     there); RLS stays the real defence (unknown org ⇒ zero rows, fail closed).
     Timestamps normalized with the canonical `fromDbDate` (postgres-js returns
     timestamptz as strings).
- **Frontend:** `settings/modules/page.tsx` surfaces backend error codes in a
  dismissible banner instead of swallowing them; new `modules.startTrialError`
  key in en/ar/fr/es.
- **Tests:** trial use-case spec (no-subscription bootstrap + USD fallback),
  role-matrix spec (module grants per role), and a new
  `tests/integration/entitlements.integration.test.ts` (4 tests) proving
  RLS-scoped reads, live state reflection through `EntitlementService`, and
  upsert/updateState transitions.
- **Validation:** `pnpm typecheck` 7/7, API unit suite **1342/1342**, CRM +
  entitlements integration **11/11** (real Postgres + RLS), lint clean on
  changed files (only the pre-existing project-service baseline for
  `tests/integration/*`), Prettier clean.

#### Follow-up (Session 33 continued) — company create 500 + error UX

- **Company create returned 500 `INTERNAL_ERROR` from the frontend.** Root cause
  (reproduced through the real stack with a drizzle SQL logger):
  `crm_companies.address` is `jsonb`, but the raw-SQL repositories bound the
  DTO's `{}` default as a plain JS object — drizzle's postgres-js driver does
  **not** JSON-stringify plain objects (same identity override as dates in
  `db-date.ts`), so postgres-js threw `ERR_INVALID_ARG_TYPE` → unhandled → 500.
  `insertCompany`/`updateCompany` now serialize explicitly
  (`JSON.stringify(address ?? {})::jsonb`, mirroring the pipeline repo's
  `name_i18n` pattern) and default `ownerUserId` to `null` (binding `undefined`
  through drizzle also produces a Postgres syntax error).
- **Duplicate-email 422 was correct behaviour with bad UX.** The CRM forms
  called `mutateAsync(...).then(...)` with no `.catch()`, so the machine-
  readable `ApiError` surfaced raw. `CrmWorkspace` now catches mutation errors,
  maps `ApiError.code` → `modules.crm.errors.*` i18n keys
  (`CRM_CONTACT_DUPLICATE_EMAIL`, `CRM_CONTACT_REQUIRES_IDENTITY`, deal
  reference/FX, activity assignee, generic fallback) and shows a dismissible
  localized alert banner; keys added to en/ar/fr/es.
- **Regression test added:** `tests/integration/crm.integration.test.ts` covers
  company create → update → list with a non-empty jsonb address round-trip
  through the real use cases (8/8 suite).
- **Validation:** `pnpm typecheck` 7/7, API unit **1342/1342**, CRM +
  entitlements integration **12/12**, web **132/132** (i18n parity), Prettier
  clean, no new lint errors (pre-existing `as`-cast baseline unchanged).

#### Follow-up (Session 33 continued) — detail pages + deal-form select fix

- **Deal form selects were dead.** The `Select` component’s explicit `onChange`
  clobbered the react-hook-form `register()` handler spread into `props`, and
  the select was controlled to `''` (value prop undefined), so RHF never
  received the contact/company selection. `Select` now forwards both the
  spread-in `onChange` AND `onValueChange`, and only controls `value` when
  explicitly provided — fixes the deal/merge forms and the pipeline move select
  (React 19 passes `ref` through function components, so RHF refs attach).
- **Detail pages (contacts, companies, deals) added** per user request:
  - API: `findContactById`/`findCompanyById`/`findDealById` on the read
    repository (deal detail includes the append-only CRM-6 stage history,
    newest-first, with bigint/numeric rows typed) + `GetContactUseCase`/
    `GetCompanyUseCase`/`GetDealUseCase` (fail-closed `NOT_FOUND`) + three
    `GET /v1/crm/.../:id` routes guarded by `crm:*:read`; OpenAPI + typed
    api-client regenerated.
  - Web: `details.tsx` with full record view, inline edit (reuses the PATCH
    endpoints + existing schemas), and client-side related records (deals/
    activities on a contact; contacts/deals on a company); deal detail shows
    value (display-formatted from minor units), stage, status badge, closed
    info, and a stage-history timeline with durations. Cards are now links to
    their detail pages. Detail i18n keys added to en/ar/fr/es.
  - `crmErrorKey` extracted to `features/crm/errors.ts` and reused by the
    workspace and detail pages.
- **Latent bug fixed while linting:** `EnsureDefaultPipelineUseCase` had been
  merged into a comment in `crm.module.ts` providers during an earlier edit
  (would have broken Nest DI for `CreateDealUseCase` at boot) — restored; the
  unused import in `crm-queries.use-cases.ts` removed.
- **Tests:** controller metadata covers the three new GET routes (14 tests);
  integration suite covers contact/company/deal getById round-trips incl. stage
  history and `NOT_FOUND` fail-closed (9 tests).
- **Validation:** `pnpm typecheck` 7/7, API unit **1347/1347**, CRM integration
  **9/9**, web **132/132**, Prettier clean, web lint 0 errors, API lint only the
  pre-existing `as`-cast baseline, OpenAPI + api-client regenerated.

### Session 32 — Phase 4 Step 4.9: CRM isolation and architecture

- **Real tenant-isolation suite:** replaced the scaffold assertion with eight
  Testcontainers/Postgres tests running as the non-owner `modubiz_app` role with
  all core and CRM migrations applied and FORCE RLS active.
- **Required TEN coverage:** org A cannot read, update, soft-delete, or list org
  B contacts; client-injected `organizationId` cannot override the session org;
  and an app-role query without tenant context returns zero rows.
- **Authorization denial coverage:** the actual CRM contact-list controller
  metadata is exercised through the real `EntitlementGuard` and
  `PermissionGuard`: disabled CRM returns `MODULE_NOT_ENTITLED` even to an
  OWNER, while an entitled user without `crm:contact:read` receives a forbidden
  denial.
- **Isolation runner hardened:** `vitest.isolation.config.ts` now has repository
  root resolution, 180-second hook/test timeouts, and serial file execution for
  stable Testcontainers startup.
- **Validation:** CRM isolation **8/8**, architecture **8/8**, dependency cruise
  0 errors (existing orphan warnings only), and API typecheck clean. The legacy
  API `test:arch` script still references a missing `vitest.arch.config.ts`; the
  canonical root architecture spec was run directly and passed.

### Session 31 — Phase 4 Step 4.8: CRM frontend

- **Missing read surface completed before UI work:** added RLS-scoped contact,
  company, deal, activity, and default-pipeline reads plus company create/update
  endpoints. The default pipeline read calls the existing CRM-3 lazy ensure.
  OpenAPI and `@modubiz/api-client` were regenerated with the new routes.
- **Four routed CRM workspaces:** contacts, companies, deals, and activities now
  live under `app/[locale]/(dashboard)/m/crm/`, share a CRM layout/navigation,
  and are protected by one inherited `<ModuleGate moduleKey="crm">`.
- **Feature implementation:** `features/crm/` now contains TanStack Query hooks,
  mutation invalidation, RHF + Zod schemas/forms, responsive contact/company
  cards, activities, contact merge, and a stage-column pipeline board.
- **Pipeline interactions:** cards support native HTML drag-and-drop on desktop
  plus a native stage selector fallback for touch/keyboard users. Both drag and
  fallback controls require `crm:deal:write`; lost-stage movement asks for the
  required reason and delegates to the existing move endpoint.
- **Authorization and RTL:** introduced the reusable `<Can>` permission gate and
  wrapped every mutating CRM control. New CRM UI uses logical CSS utilities only
  and `dir="auto"` for user-entered names/titles.
- **Localization:** full CRM workspace keys were added to English, Arabic,
  French, and Spanish catalogs; a completeness test checks identical key sets.
- **Tests:** CRM frontend schemas cover CRM-1, CRM-10, and CRM-12; controller
  metadata covers new read routes; a Playwright CRM journey scaffold covers
  contact creation followed by deal creation in a seeded environment.
- **Validation:** API and web typechecks clean; targeted controller, domain,
  contract, and i18n tests green; targeted Prettier gate clean. Full E2E remains
  environment-gated and is exercised in the Phase 4 final verification.

### Session 30 — Phase 4 Step 4.7: CRM events

- **All five declared CRM events verified end-to-end:** contact created/updated,
  deal stage changed, won, and lost. No handlers were added because CRM is
  independent at this phase, exactly as PLAN 4.7 specifies.
- **After-commit collection hardened:** CRM event-producing use cases now return
  pending events from their transaction and add them to `UnitOfWork` only after
  `TransactionManager.run()` resolves. A rollback or commit failure therefore
  cannot leave a stale CRM event in the singleton buffer for a later request to
  publish.
- **Contract/model mismatch fixed:** contact and deal ownership is nullable in
  the CRM schema, domain, and API. The four owner-bearing event payloads now
  model `ownerUserId` as nullable instead of publishing an invalid empty string
  or falsely substituting the user who moved a deal.
- **Payload correctness:** won-event FX rates are serialized as plain decimal
  strings even when JavaScript would use exponent notation. CRM-7 now rejects a
  whitespace-only lost reason in the domain, so the emitted lost payload always
  satisfies its non-empty contract.
- **Contract and integration coverage:** contract fixtures cover unowned
  contacts/deals; domain tests cover blank lost reasons; real-Postgres CRM tests
  parse actual emitted contact-created, contact-updated, stage-changed, won, and
  lost payloads with the exported Zod schemas and verify event order plus
  rollback silence.
- **Validation:** CRM integration **7/7**, targeted contract/domain tests
  **71/71**, API typecheck clean, targeted format clean, API lint 0 errors
  (existing warning baseline only).

### Session 29 — Phase 4 Step 4.6: CRM API layer

- **Level 2 read ports — `PortRegistry` gets its first production consumers.**
  Three cross-boundary reads (CRM-14 active members, CRM-8 base currency, CRM-8
  FX rate) declared in `@modubiz/contracts`
  (`packages/contracts/src/ports/index.ts`):
  `MembershipReadPort`/`MEMBERSHIP_READ_PORT`, `OrganizationReadPort`/
  `ORGANIZATION_READ_PORT`, `FxRateReadPort`/`FX_RATE_READ_PORT` — the
  contracts-first declaration per ARCHITECTURE §6 Level 2.
- **Read-port adapters (3):** `DrizzleMembershipReadPort` (active members of an
  org, excluding deleted), `DrizzleOrganizationReadPort` (base currency),
  `DrizzleFxRateReadPort` (latest prior-snapshot rate via the existing FX
  repository) — each a thin RLS-scoped `TransactionManager.run()` read over the
  provider module's own repository. Registered in the core `PortRegistry` by
  each platform module's `onModuleInit`.
- **CRM DTOs (`api/dto/crm.dto.ts`)** — zod request schemas
  (CreateContact/UpdateContact/MergeContacts/CreateDeal/MoveDealStage/
  CloseDeal/ReopenDeal/CreateActivity/CompleteActivity) + `createZodDto`
  classes + response envelope classes (`ContactsEnvelopeResponse`, …), matching
  the platform DTO conventions from 4.0.2. Email/phone refine mirrors CRM-1;
  lostReasonCode required when toStage is lost (CRM-7).
- **Three controllers (one per resource, matching the platform convention):**
  `api/contacts.controller.ts`, `api/deals.controller.ts`,
  `api/activities.controller.ts` — each with class-level
  `@RequiresModule('crm')` (entitlement) + `@RequiresPermission` on the mutation
  routes (RBAC runs after entitlement per authorization module); `@Audit`
  metadata on every mutating route (AUD-1 entries from the core interceptor);
  Zod DTO validation pipes; typed `@ApiCreatedResponse/@ApiOkResponse`
  envelopes. Routes: `POST /v1/crm/contacts`, `PATCH /v1/crm/contacts/:id`,
  `POST /v1/crm/contacts/merge`, `POST /v1/crm/deals`,
  `POST /v1/crm/deals/:id/move-stage`, `POST /v1/crm/deals/:id/close`,
  `POST /v1/crm/deals/:id/reopen`, `POST /v1/crm/activities`,
  `POST /v1/crm/activities/:id/complete`. Scaffold `status` probe +
  `GetStatusUseCase` removed (all routes are real gated business routes — no
  dead code per DoD).
- **CRM-14 wiring:** the controller resolves the org's active-member ids via the
  `MembershipReadPort` and passes them into `CreateActivityUseCase` — the
  cross-module read happens at the boundary (controller), never as an import.
  Similarly `CreateDealUseCase` receives `baseCurrency` (OrganizationReadPort)
  - FX rate (FxRateReadPort) — RLS-scoped reads, one transaction each.
- **Bug found & fixed — interfaces as Nest DI tokens:** the three platform
  modules injected the contracts _interface_ types
  (`MembershipReadPort`/`OrganizationReadPort`/`FxRateReadPort`) as Nest DI
  tokens in their module class constructors. Interfaces are erased at compile
  time, so Nest resolved them as `undefined` and the whole app failed to boot
  with `Nest can't resolve dependencies of the FxRatesModule (PortRegistry, ?)`.
  The error was invisible because `generate-openapi.ts` ran with `logger: false`
  and `process.exit(1)` truncated the async error write — instrumented the
  entrypoint with synchronous `writeSync(2, …)` diagnostics, then fixed the
  three modules to inject the **concrete class** (Nest resolves runtime
  providers) while keeping the interface only for the property annotation. The
  app boots cleanly (`ModuBiz API started, port 4000`) and generation works.
- **`generate-openapi.ts` hardened:** error handler now writes synchronously to
  fd 2 (never truncates the failure reason on `process.exit`). The temporary
  `exit` event diagnostic + debug progress markers were removed once the boot
  bug was fixed. This is the same entrypoint used by `pnpm generate:api-client`.
- **Port resolution timing documented** — platform modules register read ports
  in `onModuleInit`, which Nest runs AFTER all providers are instantiated;
  consumers (CRM controllers) therefore resolve ports lazily at REQUEST time,
  never in the constructor. This contract is documented on the registration
  sites and in both controllers that resolve ports.
- **Review-driven fixes (4):** (1) the single 10-param `CrmController` was
  **split into three controllers** (contacts/deals/activities) — fixes the
  `max-params` 10 + `max-lines` 311 lint warnings structurally and matches the
  platform one-controller-per-resource convention; (2) **13 new unit tests**:
  `crm.controllers.spec.ts` (6 — AUTHZ-6 entitlement metadata on all three
  controllers + permission/audit metadata on every route),
  `drizzle-membership-read.port.spec.ts` (3 — CRM-14 active-only ids,
  fail-closed empty set), `drizzle-organization-read.port.spec.ts` (2 — CRM-8
  base currency + ORG_NOT_FOUND), `drizzle-fx-rate-read.port.spec.ts` (2 — rate
  snapshot + undefined when no snapshot); (3) fixtures fixed to the real
  `MembershipData`/`OrganizationData` shapes (`roleId`, `joinedAt`,
  `deletionScheduledAt`); (4) unused `process.on('exit')` diagnostic removed.
- **OpenAPI regenerated (DoD gate):** `openapi.json` now contains the 4 CRM
  route families (`/v1/crm/contacts`, `/v1/crm/contacts/merge`, `/v1/crm/deals`,
  `/v1/crm/activities`; 9 CRM path refs) alongside the 19 platform paths;
  `@modubiz/api-client` regenerated from it (9 `v1/crm` refs in the typed
  client).
- **Validation:** full unit suite **1321/1321** (+13 new), arch **8/8**,
  `pnpm typecheck` 7/7, API tsc clean, `pnpm lint` 0 errors (33 style warnings —
  `max-params`/`max-lines`, matching the platform baseline), format gate clean,
  app boots to `http://127.0.0.1:4000`, `generate:api-client` chain green, CRM
  integration **5/5** still green.

### Session 28 — Phase 4 Step 4.5: CRM application layer

- **Application ports (6):** `contact-repository.port.ts`,
  `pipeline-repository.port.ts`, `deal-repository.port.ts` (incl.
  `appendHistory` — append-only ledger + `reassignContact` for CRM-12),
  `activity-repository.port.ts` (incl. `reassignRelated`),
  `note-repository.port.ts`, `attachment-repository.port.ts` — each bound to a
  `Symbol` DI token.
- **Drizzle repositories (6):**
  `drizzle-contact|pipeline|deal|activity|note|attachment.repository.ts` —
  raw-SQL (`sql` template) with RLS-scoped queries (no manual organization_id
  filters), `RETURNING *` on insert/update, `deleted_at IS NULL` guards, bigint
  money columns (`BigInt(row.value_amount_minor)`), Date conversion via
  `fromDbDate`/`toDbDate`.
- **`EnsureDefaultPipelineUseCase` (CRM-3)** — lazy idempotent `ensure(tx)`
  called INSIDE the caller's transaction: `findDefault` → no-op if present, else
  creates the standard pipeline (New 10% → Qualified 40% → Won 100% → Lost 0%).
  No framework hook — the generated `db/seed-on-enable.ts` scaffold was
  **deleted** per PLAN 4.5.
- **Contact use cases:** `CreateContactUseCase` (CRM-1 identity + CRM-2
  duplicate-email guard via `findByEmail`, publishes `crm.contact.created.v1`),
  `UpdateContactUseCase` (partial update — exactOptionalPropertyTypes-clean
  conditional props, re-validates CRM-1, CRM-2 against OTHER non-deleted
  contacts, publishes `crm.contact.updated.v1`), `MergeContactsUseCase` (CRM-12
  — reassigns activities/notes/attachments/deals via
  `reassignRelated`/`reassignContact`, soft-deletes source, rejects self-merge).
- **Deal use cases:** `CreateDealUseCase` (CRM-3 lazy ensure, CRM-10
  contact-or-company, CRM-8 FX snapshot via
  `deal.setValue(Money, baseCurrency, fxRate)`), `MoveDealStageUseCase` (CRM-6
  history append + CRM-7 lost-reason + CRM-9 close; publishes
  `crm.deal.stage_changed.v1` + `crm.deal.won.v1`/`crm.deal.lost.v1`),
  `CloseDealUseCase` (resolves the pipeline's won/lost stage, delegates to
  MoveDealStage — one event path), `ReopenDealUseCase` (CRM-9 — requires
  `crm:deal:write` permission from `TenantContext.getPermissions()`, moves to
  first open stage, appends history, never clears
  `closed_at`/`lost_reason_code`).
- **Activity use cases:** `CreateActivityUseCase` (CRM-14 —
  `assignTo(userId, activeMemberIds)` rejects non-active assignees; API layer
  resolves the active-member set in Step 4.6 via a read port),
  `CompleteActivityUseCase` (CRM-13 — idempotent complete for retries).
- **All mutating use cases** run inside `TransactionManager.run()` (RLS-bound
  `SET LOCAL`), collect events on `UnitOfWork.addEvent()` and publish via
  `publishEvents()` AFTER commit (OPS-3). Audit entries are recorded by the API
  layer's `@Audit` interceptor in Step 4.6 (AUD-1) — use cases stay pure
  (established Phase 2 pattern).
- **`crm.module.ts` wired:** all 6 repository port-token bindings + 10 use cases
  as providers. **`seed-on-enable.ts` deleted** (CRM-3 is lazy — no dead code
  per DoD).
- **Integration tests — `tests/integration/crm.integration.test.ts` (5 tests,
  real Postgres + RLS, `modubiz_app` role):**
  - `CRM-3: first deal write ensures exactly one default pipeline; a second call is a no-op`
  - `CRM-6: appends a row to crm_deal_stage_history on every stage change` (2
    moves → 2 rows, durations ≥ 0; closed deal rejects direct move CRM-9)
  - `CRM-8: deal value in non-base currency stores FX rate snapshot` (€100 @ 1.1
    → exchange_rate 1.1, base_amount_minor 11000)
  - `CRM-12: merge moves activities, notes, deals, attachments to the surviving contact`
  - `publishes crm.deal.won.v1 only after commit` (rolled-back lost-move without
    reason publishes nothing; won move publishes stage_changed + won after
    commit)
- **Validation:** full unit suite **1308/1308**, CRM integration **5/5** (full
  integration suite re-run), arch **8/8**, API + root typecheck clean,
  `pnpm lint` 0 errors (19 style warnings on the new files —
  `max-params`/`max-lines`, consistent with the platform baseline), format gate
  clean.

### Session 27 — Phase 4 Step 4.4: CRM domain layer

- **Dependency:** `@modubiz/money@workspace:*` added to `apps/api` (Deal value
  - FX snapshot per hard rule #3 — money never leaves the Money value object;
    lockfile + frozen-lockfile verified).
- **`domain/errors.ts`** — replaced the scaffold `CrmDomainError` with
  **`CrmError extends DomainError`** (→ 422 via the shared error model) + a
  stable `CRM_ERROR_CODE` map: `CONTACT_REQUIRES_IDENTITY` (CRM-1),
  `CONTACT_DUPLICATE_EMAIL` (CRM-2), `PIPELINE_DEFAULT_DELETE` (CRM-3),
  `PIPELINE_INVALID_STAGES` (CRM-4), `PIPELINE_POSITIONS_NOT_CONTIGUOUS`
  (CRM-5), `LOST_REASON_REQUIRED` (CRM-7), `DEAL_FX_RATE_REQUIRED` (CUR-5),
  `DEAL_VALUE_NEGATIVE` (DATA_MODEL §5), `DEAL_REOPEN_PERMISSION`,
  `DEAL_NOT_CLOSED`, `DEAL_CLOSED_CANNOT_MOVE` (CRM-9),
  `DEAL_REQUIRES_REFERENCE` (CRM-10), `ACTIVITY_COMPLETED_IMMUTABLE` (CRM-13),
  `ACTIVITY_ASSIGNEE_NOT_ACTIVE_MEMBER` (CRM-14), `ACTIVITY_RELATED_PAIR` (DB
  CHECK).
- **`domain/contact.entity.ts`** — `Contact` enforcing **CRM-1** (at least one
  of email/phone, re-validated on `update`) and **CRM-2** (`assertEmailUniqueIn`
  — case-insensitive compare matching the citext column, throws
  `CRM_CONTACT_DUPLICATE_EMAIL`), plus `markDeleted` (CRM-11 soft delete).
- **`domain/pipeline.entity.ts`** — `Pipeline` + `PipelineStage` enforcing
  **CRM-3** (default pipeline cannot be deleted), **CRM-4** (≥1 stage, exactly
  one `is_won` + one `is_lost`), **CRM-5** (positions contiguous 0..n-1;
  `reorderStages` rewrites positions atomically). Stage probability range 0..100
  mirrors the DB CHECK.
- **`domain/deal.entity.ts`** — `Deal` enforcing **CRM-6** (`moveToStage`
  appends a `DealStageHistoryData` entry with elapsed `durationSeconds` in the
  previous stage), **CRM-7** (lost target requires `lost_reason_code`),
  **CRM-8** (`setValue(value: Money, baseCurrency, fxRate)` — snapshots
  `exchange_rate` + `base_amount_minor` via `Money.convertTo` when the value
  currency differs from the org base; refuses to store a foreign-currency value
  without a rate), **CRM-9** (`moveToStage` to a won/lost stage sets `status` +
  `closed_at`; closed deals cannot move directly; `reopen` requires
  `crm:deal:write` and appends history while **never clearing timestamps**),
  **CRM-10** (requires contact or company). Stage history entries carry the
  id/org/deal/from/to/moved fields of `crm_deal_stage_history`.
- **`domain/activity.entity.ts`** — `Activity` enforcing **CRM-13** (completed
  activities reject all edits — notes are appended in `crm_notes`, never on the
  row; `complete()` is idempotent for retries) and **CRM-14** (`assignTo`
  rejects any user outside the org's active-member set). Related-pair CHECK
  enforced.- **Tests (55 rule-cited, in `__tests__/unit/`):** contact 11,
  pipeline 17, deal 18, activity 10 — every PLAN 4.4 required case present
  verbatim: `CRM-1: rejects a contact with neither email nor phone`,
  `CRM-2: rejects a duplicate email per organization`,
  `CRM-4: rejects a pipeline without exactly one is_won and one is_lost stage`,
  `CRM-5: rejects non-contiguous stage positions`,
  `CRM-7: rejects moving to a lost stage without a reason code`,
  `CRM-9: reopening a closed deal appends history, never clears timestamps`,
  `CRM-13: a completed activity cannot be edited except to append notes`.
  Scaffold `crm.item.ts` + `crm.spec.ts` deleted.
- **Review-driven fixes (4):** (1) `reorderStages` now rejects **duplicate stage
  ids** (`new Set(...).size !== length`) — previously `['s1','s1','s2']` passed
  the length guard and silently dropped a stage; (2) `addStage` now validates
  the per-stage **probability 0..100** (was only caught at the DB layer); (3)
  `Activity.assignTo` is now also blocked on **completed** activities
  (reassignment is an edit — CRM-13); (4) `Deal.create` now validates
  **status/closedAt/lostReason coherence** mirroring the DB CHECKs
  (`DEAL_CLOSED_AT_REQUIRED`, `LOST_REASON_REQUIRED`).
- **Validation:** full unit suite **1308/1308** (1253 + 55 new), arch **8/8**,
  `pnpm typecheck` 6/6, `pnpm lint` 6/6 (0 errors), format gate clean,
  `pnpm install --frozen-lockfile` green. No framework imports in `domain/`
  (hard rule #7); no cross-module imports (only `@modubiz/money` + core error
  model).

### Session 26 — Phase 4 Step 4.3: CRM schema + RLS migrations

- **`apps/api/src/modules/crm/db/migrations/0001_init.sql`** — all **11 CRM
  tables** per DATA_MODEL §7: `crm_companies`, `crm_contacts`, `crm_pipelines`,
  `crm_pipeline_stages`, `crm_deals`, `crm_deal_stage_history`,
  `crm_activities`, `crm_notes`, `crm_tags`, `crm_taggables`, `crm_attachments`.
  Every table carries the mandatory base columns (id, organization_id,
  created_at, updated_at, created_by, updated_by, deleted_at) except
  `crm_deal_stage_history`, which is an **append-only ledger** (no updated_at,
  no deleted_at). Module tables deliberately do NOT FK into `core_*`
  (extractability — same as the generator scaffold); in-module FKs are explicit
  and indexed; `value_currency char(3)` matches
  `core_organizations.base_currency` (no FK — currency validated via
  `@modubiz/money`).
- **DB-enforced business rules:** CHECK `ck_crm_contacts_identity` (**CRM-1**
  email-or-phone), partial unique `uq_crm_contacts_org_email` (**CRM-2**),
  `uq_crm_pipelines_org_default` (**CRM-3** exactly one default), `won`/`lost`
  partial uniques (**CRM-4**), `uq_crm_pipeline_stages_position` (**CRM-5**),
  `prevent_update_delete` trigger on stage history (**CRM-6** append-only),
  `ck_crm_deals_lost_reason` (**CRM-7**), `ck_crm_deals_closed_at` (**CRM-9**),
  `ck_crm_deals_references` (**CRM-10** contact-or-company). Money pairs on
  `crm_deals` (`value_amount_minor bigint` + `value_currency char(3)` +
  `exchange_rate numeric(20,10)` + `base_amount_minor bigint`) per DATA_MODEL
  §5/CRM-8. `set_updated_at` triggers reuse the core 0004 function;
  `prevent_update_delete` reuses the core 0005 function.
- **`0002_rls.sql`** — the standard **hardened NULLIF policy** (DATA_MODEL §2,
  same form as core 0008) applied `FOR ALL TO modubiz_app` to all 11 tables,
  with ENABLE + FORCE ROW LEVEL SECURITY. Fail-closed: no tenant context ⇒ zero
  rows.- **Review-driven fixes (4):** (1) `crm_contacts.email` → **citext**
  (like `core_invitations`) so the CRM-2 partial unique index is
  case-insensitive — `Ada@x.com` and `ada@x.com` are the same address at the DB
  layer; (2) `CHECK (value_amount_minor >= 0)` on `crm_deals` (mirrors
  `ck_pos_sales_total_non_negative`); (3) `crm_taggables` gained `created_by`
  (matches `core_role_permissions` join-table convention); (4) **composite FK
  `fk_crm_deals_pipeline_stage (pipeline_id, stage_id) → crm_pipeline_stages (pipeline_id, id)`**
  with supporting unique index — a deal can never reference a stage from a
  different pipeline.
- **Verified against real Postgres** (dev DB, `pnpm db:migrate`): both
  migrations applied under namespaced keys (`crm/0001_init.sql`,
  `crm/0002_rls.sql`); all 11 tables have `rowsecurity=t` + FORCE; trigger
  inventory confirmed; live probes: CRM-10 rejects a deal without
  contact/company, CRM-6 `UPDATE crm_deal_stage_history` raises "append-only… No
  UPDATE or DELETE allowed", and a two-`is_won`-stage insert would trip the
  partial unique. After the 4 review fixes the tables were dropped + tracking
  rows removed and re-migrated clean; `email` now reports USER-DEFINED (citext),
  the composite FK and non-negative CHECK are present. Test rows cleaned up
  afterwards.
- **Validation:** full unit suite **1253/1253**, integration **65/65** (real
  Postgres — `applyAllMigrations` now applies the CRM migrations in every
  suite), arch **8/8**, `pnpm typecheck` 6/6, `pnpm lint` 6/6, format gate
  clean. The placeholder `db/schema.ts` + `seed-on-enable.ts` remain for Steps
  4.4/4.5 (seed-on-enable gets DELETED per PLAN 4.5 — CRM-3 is lazy).

### Session 25 — Phase 4 Step 4.2: CRM module scaffolded

- **`pnpm generate:module crm` now works — but only after fixing a real
  generator bug + a workspace gap.** `@modubiz/generator-module` sits at
  `tooling/generators/module/` (two levels deep), but `pnpm-workspace.yaml` only
  globbed `tooling/*` — so the package was never linked and
  `pnpm generate:module` failed with "No projects matched the filters" before
  doing anything. Added `'tooling/*/*'` to the workspace packages list (13
  projects now); lockfile updated, frozen-lockfile install still green.
- **Generator anchor bug (would break EVERY future module):** `register.mjs`
  located the contracts import and the app.module imports terminator by **exact
  string match** on
  `import { defineModule, type ModuleDescriptor } from '@modubiz/contracts';`
  and `FxRatesModule,\n ],`. Step 4.1 added `CRM_EVENTS` to the contracts
  import, so the anchor silently stopped matching — the first run scaffolded all
  28 files then crashed at registration (and the second run hit a `matchAll`
  non-global regex crash, then a third found the imports-array replacement
  inserting the class AFTER the `],`). All three fixed: (1) descriptor anchor
  now a line regex
  `/^import \{ [^}]*defineModule[^}]* \} from '@modubiz\/contracts';$/m`; (2)
  module import anchor matches the LAST platform import line; (3) imports-array
  terminator matches `(\n    \w+Module,\n)(  \],)` with a capture group so the
  new class lands before the closing bracket. Registration now completes
  end-to-end: descriptor import + array entry in `registered-modules.ts`,
  `CrmModule` in `app.module.ts`, i18n skipped (CRM keys exist), contracts
  rebuilt.
- **28 backend files + web page scaffolded** under `apps/api/src/modules/crm/`
  (descriptor, module, controller, dto, application use case + ports, domain
  entity + errors, infrastructure, events (published/handlers), jobs, search
  contributor, db (schema, seed-on-enable), public barrel, and
  unit/integration/isolation test skeletons) plus
  `apps/web/src/app/[locale]/(dashboard)/m/crm/page.tsx` (ModuleGate-wrapped)
  and `apps/web/src/features/crm/index.ts`.
- **CRM descriptor moved into the module** (per MODULE_GUIDE §2 — the descriptor
  belongs to the module; the registry is a thin composition root): the Phase 3
  inline CRM descriptor was removed from `registered-modules.ts` and its full
  surface (9 permissions, 5 events via `CRM_EVENTS` constants, 3 nav items, 2
  dashboard widgets, `searchContributor: true`, icon `users`) now lives in
  `crm.descriptor.ts` — imported back into the registry as `crmDescriptor`. No
  boot-validation or catalog drift.
- **Placeholder migrations deleted (collision trap avoided):** the scaffold
  ships `db/migrations/0001_init.sql` creating a throwaway `crm_items` table.
  Because `applyAllMigrations` auto-applies every module's migrations, those
  placeholders would have been tracked as `crm/0001_init.sql` in `_migrations` —
  then Step 4.3's REAL 0001_init.sql (same filename, same namespace) would be
  silently skipped on any existing DB. Deleted both placeholder SQL files; the
  empty dir is skipped by `discoverModuleMigrationDirs` (verified by the 65/65
  integration suite). Step 4.3 writes the real schema.
- **Validation:** API typecheck clean, web typecheck clean (via `pnpm typecheck`
  6/6), unit suite **1253/1253** (75 files; +3 CRM scaffold tests), arch 8/8,
  integration **65/65** (7 files, real Postgres), `pnpm lint` 6/6 (API src 0
  errors, 135 pre-existing warnings), format gate clean, frozen-lockfile install
  green. Lint autofix applied import-group blank lines in the two
  composition-root files.

### Session 24 — Phase 4 Step 4.1: CRM contracts declared

- **Step 4.1 (Declare contracts first) is now complete.** Audited what Phase 3
  already declared: `MODULE_KEYS.CRM = 'crm'` and `CRM_PERMISSIONS` (all 9
  permissions: contact/company/deal/activity read+write + pipeline:manage) were
  already in `@modubiz/contracts`, and the CRM descriptor already listed the 5
  event names in `publishes`. **The missing piece was the event payload
  schemas** — `packages/contracts/src/events/index.ts` was still the empty
  placeholder, and the registry hardcoded event-name strings (drift risk).
- **`packages/contracts/src/events/index.ts` now declares the 5 CRM events with
  Zod payload schemas:** `crm.contact.created.v1`, `crm.contact.updated.v1`,
  `crm.deal.stage_changed.v1`, `crm.deal.won.v1`, `crm.deal.lost.v1` — each as
  `<Module><Aggregate><Action>V1` schema + inferred type (per the file's naming
  convention). `CRM_EVENTS` const holds the stable event names. Shared
  primitives `minorUnitsString` (non-negative integer decimal string) and
  `currencyCode` (uppercase ISO 4217) enforce money rules on the wire — amounts
  travel as decimal strings (same representation `Money` uses when
  JSON-serialized), never floats (DATA_MODEL §5 M1/M2).
- **Payload fields follow DATA_MODEL §7 + BUSINESS_RULES §9:** contact events
  carry contactId/companyId/names/email/phone/ownerUserId; stage_changed carries
  dealId/fromStageId (nullable — first move)/toStageId/movedBy (CRM-6); won
  carries valueAmountMinor + valueCurrency + closedAt (CRM-8, CRM-9); lost
  carries lostReasonCode (CRM-7) + closedAt. Every payload includes
  `organizationId` + `occurredAt` per MODULE_GUIDE Step 1 (handlers run without
  the publisher's tenant context).
- **Exports:** root `packages/contracts/src/index.ts` re-exports `CRM_EVENTS` +
  all 5 schemas + inferred types + the two primitives.
  `apps/api/.../registered-modules.ts` CRM descriptor now consumes
  `CRM_EVENTS.*` constants instead of raw strings — the descriptor can never
  drift from the contract again.
- **New tests:** `packages/contracts/__tests__/events.spec.ts` — **24 tests**
  covering: exactly the five planned names; every name matches the `EventName`
  format + CRM key prefix; valid payloads parse (incl. CRM-1 either/or
  email/phone and null `fromStageId` first-move); invalid payloads rejected
  (non-uuid ids, missing organizationId, malformed email/datetime, float and
  negative amounts, lowercase/short currency codes, missing lostReasonCode).
- **Review-driven hardening (2 fixes):** (1) **CRM-1 encoded in the contact
  schemas** — `refine()` now rejects a payload with both `email` and `phone`
  null, making the contract self-validating for consumers (tests assert the
  both-null rejection on created + updated); (2) **FX snapshot on
  `crm.deal.won.v1`** — optional `exchangeRate` (decimal string,
  `numeric(20,10)`-safe) + `baseAmountMinor` so base-currency pipeline totals
  can be computed without a re-query (CRM-8, DATA_MODEL §5). New shared
  `decimalString` primitive (plain decimals only — no floats, no exponents)
  added alongside `minorUnitsString`/`currencyCode`. Also renamed a
  self-contradictory updated-schema test description.- **Validation:**
  contracts + arch suites **88/88** (24 new), full unit suite **1250/1250** (75
  files), `pnpm typecheck` 6/6, `pnpm lint` 6/6 (contracts is outside the lint
  gate — no lint script/config, matching module.spec.ts), API typecheck +
  registry lint clean, Prettier clean, format gate clean. Contracts `dist`
  rebuilt so the API resolves the new exports.

### Session 23 — Phase 4 Step 4.0.2: OpenAPI + api-client pipeline

- **Stack-locked deps added:** `@nestjs/swagger@11.4.6` + `nestjs-zod@5.5.0` to
  `apps/api`; `openapi-typescript@7.13.0` + `prettier` to `@modubiz/api-client`.
  `@scarf/scarf` (transitive telemetry from swagger-ui-dist) build explicitly
  blocked via `pnpm-workspace.yaml` `allowBuilds` — this also fixed a pnpm
  install gate that had started failing.
- **Full DTO sweep to `createZodDto` (request + response):** every platform
  module's request schemas now export a `class X extends createZodDto(schema)`
  (type-preserving — the class instance type is the schema output type, so all
  `z.infer`-typed call sites compile unchanged); every response interface became
  a zod schema + `createZodDto` class, plus per-module **response envelope**
  classes matching the `{ data: ... }` wire format
  (`OrganizationEnvelopeResponse`, `AuthEnvelopeResponse`,
  `SessionsEnvelopeResponse`, …). Barrels (`dto/index.ts` and module
  `api/index.ts`) now value-export the DTO classes so `design:paramtypes`
  metadata resolves them for swagger reflection.
- **Controllers annotated:** all ~30 routes across 10 platform controllers now
  declare `@ApiOkResponse` / `@ApiCreatedResponse` with the envelope types;
  validation still uses the existing custom `ZodValidationPipe(schema)` — zero
  runtime behaviour change (error shape untouched).
- **`apps/api/src/swagger.ts` + `generate-openapi.ts`:** `DocumentBuilder` +
  `SwaggerModule.createDocument` (Fastify: runs after `await app.init()`),
  post-processed with `cleanupOpenApiDoc`, emitted to
  `packages/api-client/openapi.json`. Repo root is located by walking up to
  `pnpm-workspace.yaml` (compiled `dist/src/` sits one level deeper than `src/`,
  so a compile-time relative path is wrong in one of the two); the one-shot CLI
  calls `process.exit(0)` after writing because the postgres pool keeps the
  event loop alive. Process.env is NOT read here (arch rule 9 — the arch test
  caught and rejected an earlier `OPENAPI_OUTPUT` override; dropped it).
- **`generate:api-client` is now real:** root script chains
  `api generate:openapi:build` (nest build + emit `openapi.json`) then
  `@modubiz/api-client generate`
  (`openapi-typescript openapi.json -o src/index.ts && prettier --write`).
  Verified **idempotent** (md5-stable across re-runs); `openapi.json` added to
  `.prettierignore` so the generator's `JSON.stringify` output doesn't fight the
  repo format gate.
- **Output:** `openapi.json` = **44 paths, 57 component schemas, 22 routes with
  request bodies**; generated client = 2367-line typed `paths`/`components`/
  `operations` module that typechecks standalone. Web consumption of the typed
  client (`apps/web/src/lib/api`) is the remaining 4.0.2 follow-up (plan step
  5), deferred to keep this change reviewable.
- **Schema-name collision caught in review & fixed:** billing and
  module-registry BOTH exported a `DisableModuleDto` class backed by different
  zod schemas (`moduleKey` min(1) vs min(1).max(64)). Because the class name is
  the OpenAPI `components.schemas` key, swagger silently collapsed the pair —
  billing's disable route $ref'd module-registry's (stricter) schema. Renamed
  billing's to `BillingDisableModuleDto` (with a NOTE comment); both disable
  routes now reference distinct schemas (58 total). Also dropped an unused
  `resolve` import in swagger.ts and replaced the stale
  `packages/api-client/src/generated/` gitignore entry (the client is generated
  at `src/index.ts`).
- **Validation:** unit **1202/1202** (73 files), integration **65/65** (7 files,
  real Postgres), `pnpm typecheck` 6/6, `pnpm lint` 6/6 (0 errors), `pnpm test`
  6/6, arch **8/8** (process.env boundary re-verified), `pnpm format:check`
  clean, depcruise clean of new warnings. Reviewed: 4 reviewer rounds (swagger
  interop mechanism, DTO type preservation, idempotency/format interplay,
  schema-name collision).

### Session 22 — Phase 4 Step 4.0.1: module-aware migration runner

- **`runMigrations` gains an optional `namespace`** — when set, the
  `_migrations` tracking key becomes `<module>/<file>` (e.g.
  `crm/0001_init.sql`) instead of the bare filename. Core keeps bare names, so
  already-applied core rows are fully backward compatible. `rollbackMigration`
  got the same optional namespace (down file resolves from the bare name while
  the tracked key is deleted by the namespaced name).
- **`runAllMigrations(connectionString, { modulesRoot? })`** — new
  orchestration: applies `packages/db/migrations/core` first, then discovers and
  applies every module-owned migration dir under
  `apps/api/src/modules/*/db/migrations/` (override `modulesRoot` for tests).
  Discovery (`discoverModuleMigrationDirs`) is pure FS, sorted by key, skips
  missing roots / dirs without a `db/migrations` / dirs with only `.down.sql`
  files. Ordering assumption (alphabetical) documented: module tables are
  independent — cross-module FKs are forbidden by the architecture.
- **CLI `scripts/migrate.mjs`** now calls `runAllMigrations` instead of
  hardcoding the core dir — `pnpm db:migrate` applies module migrations too.
  Verified live against the dev DB: core re-run is a no-op
  (`⏭️ Already applied`), exits clean.
- **Shared test helper** `tests/integration/helpers/migrations.ts`
  (`applyAllMigrations`) — the three existing integration suites (organizations,
  audit-log, memberships) swapped their hardcoded `MIGRATIONS_DIR` +
  `runMigrations` for it, so future module migrations are applied automatically
  in every suite.
- **New tests:** `tests/integration/migrations.integration.test.ts` (3 tests,
  real Postgres): two fixture modules both shipping `0001_init.sql` +
  `0002_rls.sql` apply with distinct namespaced keys (no collision), re-run is
  idempotent, and a namespaced `rollbackMigration` removes the tracked key +
  re-apply works. `packages/db/__tests__/migrate.spec.ts` (3 unit tests) for
  `discoverModuleMigrationDirs` (sorted, skips empty/down-only/missing).
- **Bug caught during implementation:** the `discoverModuleMigrationDirs`
  docstring contained `<modulesRoot>/*/db/migrations/` — the literal `*/`
  terminated the block comment early and broke parsing. Reworded without the
  glob.
- **Validation:** integration suite **65/65** (7 files, +3 new), unit suite
  **1202 tests** (73 files), `pnpm typecheck` 6/6, `pnpm test` 6/6,
  `pnpm test:arch` 8/8 + depcruise clean of new warnings, `pnpm lint` 6/6 (db
  package has no lint script — tooling package).

### Session 21 — Phase 4 de-risked: module-migration runner + OpenAPI/api-client tooling investigated

- **Request:** investigate the two open Phase 4 questions before implementation
  so the plan is fully de-risked. Both are now resolved and written into PLAN.md
  as **Phase 4 Step 0**.
- **Q1 — module-owned migration runner:** `runMigrations(conn, dir)` in
  `packages/db/src/migrate.ts` is already generic (any dir, `_migrations`
  tracking), but (a) the CLI `scripts/migrate.mjs` hardcodes
  `packages/db/migrations/core`, so module migrations at
  `apps/api/src/modules/<key>/db/migrations/` are never applied on a fresh
  checkout; (b) the `_migrations` table keys on **filename only**
  (`name = ${file}`), so two modules both shipping `0001_init.sql` would collide
  — the second silently skipped. Plan: extend the CLI to discover
  `modules/*/db/migrations/` and run each with the module key as a namespace
  (`crm/0001_init.sql`); add a shared `applyAllMigrations` test helper; core
  keeps bare filenames (backward compatible).
- **Q2 — OpenAPI/api-client tooling:** TECH_STACK already locks
  `@nestjs/swagger` (OpenAPI 3.1) + `nestjs-zod` (DTO/OpenAPI bridge) with
  "typed client generated into `@modubiz/api-client`" — but **zero
  implementation exists**: `apps/api/src/swagger.ts` is referenced by
  `packages/api-client` yet absent, `generate:api-client` is a TODO stub, no
  codegen lib installed, and the web app still uses the hand-rolled
  `lib/api/index.ts` wrapper. **User decision: build it now as Phase 4 Step 0**
  (add the two stack-locked deps, convert zod DTOs to `createZodDto`, create
  `swagger.ts` emitting `openapi.json` — Fastify: `await app.init()` before
  `createDocument` — wire `generate:api-client` via `openapi-typescript`). Every
  later phase then satisfies its DoD line "OpenAPI regenerated" with a real
  command.
- **Related finding — `onEnableSeed` is declared but never invoked:** the
  descriptor contract has `onEnableSeed?: string` and the generator scaffolds
  `db/seed-on-enable.ts`, but no wiring exists in `EnableModuleUseCase` or
  anywhere in `apps/api/src`. **User decision for CRM-3 (default pipeline): lazy
  idempotent ensure** — the first pipeline read / deal write calls
  `ensureDefaultPipeline()` inside the transaction, creating the standard
  pipeline iff none exists. No framework hook needed; existing orgs get the
  default pipeline too. PLAN.md 4.5 updated with a CRM-3 integration test.
- **PLAN.md updated:** new Step 4.0 (4.0.1 migration runner, 4.0.2
  OpenAPI/api-client), CRM-3 lazy ensure in 4.5, real `generate:api-client` in
  4.10, and expanded Phase 4 DoD. Phase 4 can now start with zero open
  questions.

### Session 20 — Phase 3 complete: descriptor system, generator, registry wiring, ports, demo proof

- **3.1 Descriptor system finished:** contracts tests moved to
  `packages/contracts/__tests__/` (matching the money package layout); test
  fixtures fixed for the stricter `defineModule` validation (tablePrefix format,
  permissions/events key-prefixed). `validateDescriptors()` + `DESCRIPTOR_ERROR`
  codes are the single shared source of boot-validation truth.
- **3.3 Registry wiring:** `BootValidationService` refactored to call
  `validateDescriptors()` from contracts (no duplicated logic); new
  `boot-validation.service.spec.ts` (5 tests). Added **dashboard widget
  registration**: `GetDashboardWidgetsUseCase` + `GET /v1/me/dashboard/widgets`
  (mirrors the navigation endpoint — derived from entitlements, never
  hardcoded) + frontend `useDashboardWidgets()` hook + widget grid on the
  dashboard page. Widget i18n keys (recent_deals, low_stock, daily_sales, …)
  - `dashboard.widgetsTitle/widgetPlaceholder` added to all 4 catalogs.
- **3.4 Port infrastructure:** `TransactionRef` (opaque, minted only by
  TransactionManager) + `PortToken` in `@modubiz/contracts`; new `core/ports/`
  with `PortRegistry` + global `PortsModule` wired into AppModule;
  `port-registry.spec.ts` (6 tests).
- **Framework fixes:** the search contributor contract (`SearchContributor`,
  `SearchResult`, `SEARCH_CONTRIBUTORS`) moved from `platform/search/ports` to
  `@modubiz/contracts` so modules can implement search without importing
  `platform/`; added the "modules never import platform" arch test; depcruise +
  vitest arch tests now allow `registered-modules.ts` as composition root
  (platform→modules exception) and normalize Windows path separators.
- **3.2 Generator built:** `tooling/generators/module/`
  (`@modubiz/generator-module`, plain Node ESM, no build step).
  `pnpm generate:module <key>` scaffolds the full canonical skeleton (28 backend
  files incl. isolation test + web page + features folder), registers the
  descriptor + module class in the two composition-root files, adds the
  MODULE_KEYS entry, and inserts `modules.<key>` i18n keys into all 4 locale
  catalogs. Idempotent, CRLF-aware.
- **3.5 Framework proof:** ran the generator for `demo`; API + web typecheck
  green, demo unit/integration/isolation specs pass (3/3), API lint 0 errors,
  all 8 arch tests pass, depcruise 0 errors. Then deleted the demo module and
  reverted every registration edit — **the framework is unchanged**, and zero
  `core/` files were touched to add the module.
- **Post-3.5 live verification (demo2 cycle):** generated `demo2`, booted the
  API — descriptor synced to `core_module_catalog` (4 modules) — then removed
  the module and re-booted. The new **catalog prune** deleted the stale `demo2`
  row (log: `Pruned 1 stale catalog entry no longer registered: demo2`); catalog
  back to 3 rows, 0 permissions. Confirmed the original `modules.demo.name`
  marketplace bug was a stale-DB-row artifact of the one-way mirror, now fixed
  by two-way sync.
- **Two generator bugs found and fixed during the demo2 cycle:** (1)
  `defineModule` tablePrefix regex `/^[a-z]+_$/` rejected digit keys (`demo2_`),
  while the generator's key rule explicitly allows digits — relaxed to
  `/^[a-z][a-z0-9]*_$/` + tests; (2) the generator registered `MODULE_KEYS` but
  never rebuilt `@modubiz/contracts`, so the derived `PermissionKey`/`EventName`
  unions in `dist/` stayed stale and the generated module failed typecheck
  (crashing a watch-mode dev server on reload) — the generator now runs `tsc -b`
  in contracts after registering. Docs updated (MODULE_GUIDE §2).
- **Validation:** 1193 unit tests (72 files) pass, `test:arch` 8/8, API + web
  typecheck clean, API lint 0 errors (pre-existing warnings only), i18n keys in
  all 4 locales.

### Session 19 — Phase 2 verified & committed; invite-500 root cause; Phase 3 leftovers removed

- **Invite 500 root cause (the reported bug):** "Could not send the invitation.
  Please try again." with a 500 in the console was a **local-DB state issue**,
  not code: `core_invitations` was missing the `name` column because **migration
  `0012_invitation_name.sql` had never been applied** to the dev DB (Session 17
  added the column + code, but only migrated the Testcontainers DBs).
  `DrizzleInvitationRepository.insert()` references `name` →
  `column "name" does not exist` → 500. Fixed by running `pnpm db:migrate` (0012
  applied; verified via `information_schema.columns` + `_migrations`).
- **Phase 3 leftovers removed** (the messy generator session): `demo` module
  i18n keys removed from all 4 catalogs (en/ar/fr/es — nothing referenced them);
  empty generator dirs `apps/web/src/app/[locale]/(dashboard)/m/` and
  `apps/web/src/features/` deleted; the Phase 3.4 `TransactionRef` type
  (contracts `index.ts` + `ports/index.ts`) reverted so Phase 2 has zero Phase 3
  port infrastructure. `.gitignore` gains `.freebuff/` (stray local desktop-app
  DB files). No `demo` module remains in `registered-modules.ts`
  (crm/inventory/pos only) or `apps/api/src/modules/`.
- **E2E test fixes (3 defects in `invitation-flow.e2e.spec.ts`):** (1) expected
  `'Link copied!'` but the UI renders the i18n key `members.linkCopied` =
  `'Link copied to clipboard.'`; (2) expected `%20`-encoded params but the page
  builds the link with `URLSearchParams` (spaces → `+`) — assertions now build
  expected params the same way; (3) the invitee-greeting assertions ran AFTER
  navigating to signup, but the greeting (name/org/role display metadata)
  renders on the public invite page in the `needsAccount` state — moved before
  the CTA click, and the invitee now opens the **real copied link** (which
  carries the `?name=&org=&role=` metadata).
- **Verification (all green on the committed state):** `pnpm typecheck` 6/6 ✓ ·
  `pnpm lint` 6/6, 0 errors (146 pre-existing warnings) ✓ · `pnpm test` **1135
  API + 129 web unit tests** ✓ · `pnpm test:integration` **62/62** (real
  Postgres + RLS) ✓ · `pnpm test:arch` 0 errors ✓ · E2E invite→signup(locked
  email)→accept journey ✓ · `pnpm --filter web build` ✓. (`test:isolation`
  reports "no test files" — expected until Phase 4 adds a module.)
- **Commit:** all uncommitted Phase 2 work (Sessions 13–18 + this session)
  committed in one change set.

### Session 18 — Phase 2 DoD verification: billing use-case + AUTH/CUR unit specs, webhook-secret injection, suspended-transition fix

- **Billing use-case unit specs (7 files, 89 tests):** `create-subscription`
  (BILL-1 exactly-one-per-org, BILL-10 price-key catalog resolution + silent
  skip), `enable-module-trial` (BILL-2 trial-once + 14-day window, BILL-8
  dependency gate, skipTrial), `disable-module` (BILL-7 purge_after + Stripe
  item removal, BILL-9 dependent-module conflict), `handle-webhook` (BILL-5
  signature verify + idempotent replay → `WEBHOOK_ALREADY_PROCESSED`, BILL-6
  paid/failed/deleted/updated), `reconcile-entitlements` (BILL-4 Stripe-wins
  drift), `get-billing`. The existing `billing.entity.spec.ts` already covers
  the BILL-3/6/7 state machine.
- **Suspended-transition defect found by the tests (fixed):**
  `reconcile-entitlements` and the `customer.subscription.deleted` webhook
  called `validateStateTransition(..., 'suspended')` from `active`/`trialing`,
  which the state machine (PRD + `VALID_TRANSITIONS`) only permits from
  `past_due` — so drift detection and subscription deletion always threw
  `INVALID_STATE_TRANSITION` and suspended nothing. Per decision, both now map
  to **`disabled`** (active/trialing/expired → disabled; past_due → suspended,
  its only valid path). `docs/BUSINESS_RULES.md` BILL-4/BILL-5 and `docs/PRD.md`
  updated in the same change (AGENTS.md rule 10).
- **AUTH + CUR specs:** `login.use-case.spec.ts` (AUTH-7 lock on 10th failure +
  15-min lock window, AUTH-8 generic credentials + timing-equalizer, AUTH-4
  token issuance, counter reset), `password-reset.use-case.spec.ts` (AUTH-9
  single-use, 60-min expiry via fake timers, hashed-replace,
  no-email-enumeration noop token), `update-organization.use-case.spec.ts`
  (CUR-1 base-currency immutability incl. entity invariant + 422 error
  contract).
- **BILL-5 webhook-secret hardening:** `billing.controller.ts` replaced the
  hardcoded `secret: 'whsec_test'` with `ConfigService.stripeWebhookSecret`
  (`@modubiz/config`, global module) — webhooks now verify against
  `STRIPE_WEBHOOK_SECRET`.
- **Arch-test fix:** the pre-existing `process.env` boundary failure came from
  `apps/web/playwright.config.ts` reading `process.env` (E2E tooling); added
  `**/playwright.config.ts` to the arch-test ignore list.
- **Validation:** full suite **1132/1132 unit tests, 66 files** ✓,
  `pnpm typecheck` 6/6 ✓, `pnpm lint` 6/6 tasks 0 errors ✓ (146 pre-existing
  warnings). Stripe `.env` keys remain placeholders — see Stripe setup steps
  below.
- **Stripe setup (Phase 2, sandbox-only):** 1) register a Stripe account (test
  mode) → `sk_test_…`/`pk_test_…`; 2) set `STRIPE_SECRET_KEY` in `.env` (config
  validation refuses to boot without it); 3) run
  `stripe listen --forward-to http://localhost:4000/v1/billing/webhook` and set
  `STRIPE_WEBHOOK_SECRET` to the printed `whsec_…`; 4) create two test
  **prices** named `price_crm_monthly` and `price_inventory_monthly` and
  reference those exact keys (the catalog resolves `stripePriceKey` →
  entitlement); 5) keep `.env.example` in sync.

### Session 17 — invitation name (migration 0012) + audit log page (frontend + RLS read fix + DB persistence)

- **Invitation name:** `core_invitations` gains a `name` column (forward-only
  `0012_invitation_name.sql`, nullable for pre-0012 rows). The invite form now
  collects a full name (members page), the invitations list shows the name
  (email fallback for legacy rows), and the copied invite link carries
  `?name=&org=&role=` display metadata (display-only — the accept flow stays
  server-authoritative via the `user_own_invitations` RLS policy 0009). The
  public invite page renders the invitee name/email/org/role before
  authentication. `inviteUserSchema` requires `name` (zod `min(1)` — 400 at the
  boundary); `InviteUserUseCase` trims defensively (`input.name?.trim() ?? ''`)
  so direct callers can't cause a 500.
- **Audit log page (`settings/audit`):** new page (OWNER/ADMIN-only, gated on
  `platform:audit:view` both in the sidebar/settings-hub and by an
  `AccessDenied` gate for direct URLs) with entity-type/action/actor/date
  filters, pagination (pageSize 15), colored action badges, before/after
  snapshot summaries, and an empty state. `@Audit()` added to memberships
  (invite/revoke/role-change/remove), organizations
  (update/delete/cancel-deletion/settings), and roles
  (create/update/delete/assign/transfer) controllers so the log is actually
  populated.
- **Audit persistence (AUD-1/AUD-2):** the Phase 1.9 `AuditInterceptor` only
  logged in-memory. New `core/audit/audit-db-writer.ts` persists redacted
  entries to `core_audit_log` best-effort (NOTIF-1: never fail the originating
  request) inside `TransactionManager.runWithOrg` (RLS `WITH CHECK` passes;
  `core_audit_log.id` has `DEFAULT gen_random_uuid()` so omitting it from the
  INSERT is safe; system actors map `actor_user_id` → NULL +
  `actor_type='system'`; entries without an org are skipped). `AuditModule` is
  `@Global` and provides `AuditDbWriter` + `AuditInterceptor` via
  `APP_INTERCEPTOR`.
- **RLS fail-closed fix in audit reads:** `QueryAuditLogUseCase` read the
  RLS-protected `core_audit_log` table OUTSIDE a tenant-bound transaction — same
  fail-closed bug class as the billing reads. All reads now run inside
  `txManager.run()`.
- **Tests:** `audit-db-writer.spec.ts` (AUD-1 org-bound insert, system actor
  mapping, no-org skip, NOTIF-1 swallow, TEN-3 self-contained tenant rebuild);
  `audit-page.test.tsx` (OWNER sees table / MEMBER sees AccessDenied,
  system-actor label, snapshot summaries, entity-type filter, empty state via
  mutable `queryData` mock); `audit-log.integration.test.ts` (real Postgres +
  RLS: audit read permission gating, RLS-scoped read, invitation-name
  persistence); members unit tests updated for the name field (invite form
  collects name, list shows it, copied link carries metadata — URL parsed with
  `new URL` since URLSearchParams encodes spaces as `+`); memberships
  integration + E2E pass the required `name`.
- **API lint cleanup (18 pre-existing errors):** removed unnecessary
  `as never`/`as any` casts in auth/users/organizations controllers + org
  controller spec, `update-organization.use-case`, `handle-webhook.use-case`
  (`status as SubscriptionStatus`), `fx-rates.controller`, `search.module`
  (`as Provider` for the multi-provider), `correlation-id.middleware`; org
  controller inputs now use per-field conditional spreads
  (`exactOptionalPropertyTypes`-safe).
- **Validation:** API + web typecheck ✓, `pnpm lint` 6/6 tasks 0 errors ✓, API
  memberships/audit/roles/organizations unit specs 211/211 ✓, web suite 129/129
  ✓, integration suites (audit-log/memberships/organizations) 30/30 against real
  Postgres + RLS ✓, code-reviewed twice (audit module wiring + JWT
  `organizationId` claim snapshot, INSERT column parity with 0002 schema, i18n
  keys in all 4 locales, DTO name requirement).

### Session 16 — UI polish: language dropdown, auth topbar, RTL sync, root-flash fix, members page management tools

- **Language selector → dropdown** (`LocaleSwitcher`): replaces the inline
  EN/AR/FR/ES link row in the dashboard Topbar. Dropdown keeps the user on the
  same page (swaps only the `[locale]` segment), closes on outside-click/Escape,
  marks the active locale, uses only logical utilities (`end-0`) for RTL. Used
  by the dashboard Topbar AND the new auth topbar.
- **Auth pages get a top bar** (`AuthShell` + `(auth)/layout.tsx`):
  login/signup/forgot/reset/invitation pages previously had no header and no way
  to switch language. New sticky brand + LocaleSwitcher topbar; auth pages
  switched from `min-h-screen` to `flex-1` so content fills the space below the
  header without double-scroll.
- **RTL fix on client-side locale switch** (`LocaleDirectionSync`): the root
  layout sets `<html lang>/<html dir>` only from the server, so switching to
  Arabic changed the text but kept LTR until a refresh. The new client component
  (in `[locale]/layout.tsx`) syncs `dir`/`lang` on every locale change using the
  same inline `startsWith('ar')` rule as `app/layout.tsx` (deliberately NOT the
  `@modubiz/i18n` barrel — it re-exports all four catalogs and this component
  runs on every page).
- **Root `/` flash-to-login fix** (`SessionProvider` + `ShellLayout`): a 30-day
  `modubiz_authed` cookie with a 15-min access token let the server render the
  dashboard shell for a second before the first API 401 bounced to login.
  Hydration now validates the JWT `exp` claim first, tries
  `refreshStoredSession()` before deciding, clears the stale cookie + store on
  failure; `ShellLayout` shows a loading gate until
  `status === 'authenticated'`; the Topbar org query is gated on `status`
  (destructured — fixed a latent `status`-not-destructured bug). SessionProvider
  only wraps the `(dashboard)` route group, so the invitation page is
  unaffected.
- **Members page management tools** (`settings/members/page.tsx`): pagination
  (PAGE_SIZE 8, `Showing X–Y of Z`, Prev/Next), search + role + status filters
  (members and invitations), colored badges for roles (owner amber / admin rose
  / manager blue / member slate / viewer emerald) and statuses
  (active/invited/disabled; pending/accepted/revoked), the invited role shown on
  every invitation, and confirm dialogs for remove member / change role / revoke
  invitation. Invite-form errors now surface in a page-level status area (not
  inside the invite card).
- **`ConfirmDialog`** component: card-based modal (no Radix dep) with
  `role=dialog`, Escape-to-close, focus-on-open, `aria-hidden` backdrop
  (a11y-safe, `data-testid`), distinct `closeLabel` for the corner X (so
  `getByRole('button', { name: cancelLabel })` stays unambiguous), and a
  `loading` prop that disables X/Cancel/Confirm/backdrop AND suppresses Escape —
  the members page wires it via a `pendingAction` state to prevent
  double-submission of remove/role-change/revoke.
- **i18n:** new keys in en/ar/fr/es (shell.language,
  common.previous/next/delete/confirm/close already existed;
  members.searchMembers/searchInvitations/allRoles/allStatuses/showingCount/pageOf/memberStatus.*/confirmRemoveTitle+Body/confirmRoleTitle+Body/confirmRevokeTitle+Body).
  `@modubiz/i18n` dist rebuilt so the web app picks them up.
- **Tests (web suite now 118):** new `locale-switcher.test.tsx` (6),
  `confirm-dialog.test.tsx` (8), `locale-direction-sync.test.tsx` (3);
  `members-role-dropdown.test.tsx` rewritten to 16 tests covering pagination,
  filters, badges, invitation role display, and the three confirm-dialog flows
  (confirm/cancel/abort). Lint issues found and fixed along the way: `as const`
  → typed readonly arrays (base `no-restricted-syntax` bans `TSAsExpression`),
  import ordering (shell before ui), unused imports, `<option>` text colliding
  with `getByText` badge queries (fixed with `selector: 'span'`).
- **Validation:** web typecheck ✓, **118/118 web tests ✓**, eslint 0 errors on
  all changed files ✓, `@modubiz/i18n` build ✓, code-reviewed 4× (a11y of the
  dialog backdrop, double-Escape-fire, shared-mock test state, loading-gating
  dead code until `pendingAction` was wired, RTL utilities, i18n parity).

### Session 15 — org-profile PATCH authorization integration tests (real Postgres + RLS)

- **User request:** prove with an integration test that a non-OWNER/ADMIN role
  cannot PATCH the org profile against real Postgres + RLS, and that a
  mismatched `:id` fails closed with 404. (Follow-up to Session 14's
  `@RequiresPermission('platform:settings:manage')`
  - `assertSessionOrg` TEN-2 fixes.)
- **New describe block** in
  `tests/integration/organizations.integration.test.ts` — wires a REAL
  `OrganizationsController` (all 6 real use cases, real Drizzle repos, real
  `TransactionManager`) + REAL `PermissionGuard`/`Reflector` against a
  Testcontainers Postgres with RLS active (`modubiz_app` NOBYPASSRLS role):
  - **AUTHZ-5:** a VIEWER (token claims `permissions: ['platform:data:read']`
    only) cannot PATCH — `PermissionGuard` throws `ForbiddenException` (no false
    positive: if the metadata were missing, `canActivate` returns true and the
    test fails) and the org row in real Postgres is unchanged.
  - **AUTHZ-5 positive control:** an OWNER's claims pass the guard and the
    handler runs end-to-end through the RLS-applied app role — the rename to
    `Acme Rebranded` persists (verified via the bypass-owner SQL client).
  - **TEN-2:** from org A's session context, PATCHing org B's `:id` rejects with
    404 `ORG_NOT_FOUND` (`NotFoundError`) and org B's row stays untouched. Both
    orgs share the same owner, so only the `assertSessionOrg` binding protects B
    — a genuine cross-tenant regression proof for the GLOBAL non-RLS
    `core_organizations` table.
- **Root cause fixed along the way:** `tests/integration/` runs from the repo
  root under pnpm's strict isolation, so direct `@nestjs/common`/`@nestjs/core`
  imports failed to resolve (the existing integration tests never imported from
  `@nestjs/*`). Added `@nestjs/common@11.0.3`, `@nestjs/core@11.0.3`,
  `reflect-metadata@0.2.2` to root devDependencies — pinned to the EXACT
  versions apps/api uses so pnpm dedupes to a single store copy and Nest
  metadata constants stay shared. `pnpm-lock.yaml` updated via `pnpm install`.
  Added explicit `import 'reflect-metadata';` as the first import so the Nest
  decorators (`@Controller`, `@RequiresPermission`, `@UseGuards`) run their
  `Reflect.defineMetadata` calls reliably even though the polyfill is only a
  transitive dep.
- **Validation:** organizations integration suite **15/15** green against real
  Postgres + RLS (incl. the 3 new authorization tests); eslint on the changed
  files **0 errors**; `package.json` verified valid JSON; code-reviewed twice
  (test soundness incl. the no- false-positive guard assertion + direct-SQL
  setup conventions, and the reflect-metadata import placement / import-order
  insurance).

### Session 14 — org-profile edit authorization bypass (viewer could rename the org)

- **Bug (viewer could change org name/currency):** a VIEWER-role user could edit
  the organization profile. The UI showed "Something went wrong. Please try
  again." but the name change silently persisted. Root cause:
  `PATCH /v1/organizations/:id` (org profile — name, country, currency,
  timezone) had **no** `@RequiresPermission` guard — only
  `PATCH /v1/organizations/:id/settings` carried `platform:settings:manage`. The
  web form calls `updateOrganization` (name/currency) FIRST then
  `updateOrganizationSettings` (receipt footer); the first succeeded unguarded
  while the second 403'd → the generic UI error masked a persisted write.
- **Fix 1 (permission guard):** added
  `@RequiresPermission('platform:settings:manage')` to the org profile PATCH
  route. `docs/BUSINESS_RULES.md` §3 role-matrix row updated in the same change
  (AGENTS.md rule 10) to make org profile (name) editing explicitly
  OWNER/ADMIN-only.
- **Fix 2 (CRITICAL — cross-tenant `:id` hole found by review):**
  `core_organizations` is a GLOBAL (non-RLS) table and the controller passed the
  raw `:id` path param straight into every use case — so even with the
  permission guard, an OWNER/ADMIN of org A could PATCH/DELETE/read org B's
  profile (permission held, wrong resource). Added `assertSessionOrg(id)`: every
  `:id` route (`getById`, `update`, `delete`, `cancelDeletion`, `getSettings`,
  `updateSettings`) now binds to `TenantContext.requireOrganizationId()` and
  throws `NotFoundError('ORG_NOT_FOUND')` on mismatch — TEN-2 (session org
  authoritative, never request input), fail-closed.
- **Fix 3 (web UX gating):** `settings/organization/page.tsx` now gates the
  editable profile form on
  `hasPermission(permissions, 'platform:settings:manage')` — viewers see a
  read-only summary + hint instead of the form; the danger zone (delete / cancel
  deletion) is gated on `platform:organization:delete` (OWNER-only); the
  save-path error mapper now maps `FORBIDDEN` → `error.forbidden`. New i18n key
  `settings.org.readOnlyHint` added to en/ar/fr/es; `@modubiz/i18n` dist rebuilt
  so the key reaches the UI.
- **Tests:** new `organizations.controller.spec.ts` covers BOTH per-route
  permission metadata (profile + settings → `platform:settings:manage`, delete +
  cancel-deletion → `platform:organization:delete`, reads/create unguarded) AND
  behavioral `assertSessionOrg` (mismatched `:id` → 404 `ORG_NOT_FOUND` on all 6
  org routes; matching `:id` passes the SESSION org to the use case, never the
  raw param; no tenant context → fail-closed via `runWithCleanContext`). New web
  test `organization-settings.test.tsx` covers owner (form + danger zone),
  viewer (read-only, no form/delete), admin-without-delete (form but no danger
  zone), and the save path (name change via `updateOrganization` +
  `updateOrganizationSettings`).
- **Validation:** API + web typecheck ✓; organizations unit specs 29/29 ✓ (incl.
  9 controller-spec tests); web org-settings test 4/4 ✓; lint 0 errors on all
  changed files ✓; code-reviewed three times (permission-guard correctness,
  cross-tenant `:id` ownership binding, mock/DTO-mapper pitfalls in the spec,
  i18n parity).

### Session 13 — AUTHZ-2 owner-only guards, invitation manager with revoke, AccessDenied page gates

- **Bug 1 (admin could demote/remove an owner):** per BUSINESS_RULES.md §3,
  ownership management is the explicit owner-nominated transfer flow (AUTHZ-2) —
  only the OWNER role may change/remove another OWNER, even when another owner
  exists (previously only the LAST-owner guard blocked it).
  `UpdateMembershipRoleUseCase` + `RemoveMemberUseCase` now take
  `currentUserRoleKey` (from the access-token claims minted at switch-org,
  AUTHZ-5 snapshot) and throw `ONLY_OWNER_CAN_DEMOTE` / `ONLY_OWNER_CAN_REMOVE`
  when a non-owner acts on an owner. The AUTHZ-1 last-owner guard stays as the
  second check. `docs/BUSINESS_RULES.md` updated in the same change (AGENTS.md
  rule 10).
- **Bug 2 (non-admin could still open /settings/members by URL):** backend
  already enforced every action via `@RequiresPermission` (OPS-8 —
  server-authoritative), but the pages rendered anyway. Added an `AccessDenied`
  UX gate (accessDenied.* i18n) and returned it from members/roles/billing
  settings pages when the user lacks the management permission — the sidebar/hub
  already hide these entries; this covers direct-URL navigation.
- **Feature (invitation manager):** the members page Invitations section now
  shows pending / accepted / revoked status badges, an expiry hint for pending
  invites, a copy-invite-link button (id + `?email=`), and a revoke action
  (confirm dialog + `revokeInvitationErrorKey` mapping: alreadyRevoked /
  alreadyAccepted / notFound / revokeFailed). New `RevokeInvitationUseCase` +
  `POST /v1/organizations/:orgId/invitations/:id/revoke`
  (`@RequiresPermission('platform:members:invite')` — revoking cancels an
  invite). The use case reads org-scoped RLS via `txManager.run`, enforces the
  state machine through `Invitation.revoke()` (409 on accepted/revoked), 404 on
  missing/other-org, then persists + audits (global AuditInterceptor, AUD-1).
- **Bug 3 (accepting a revoked link said "expired"):** `AcceptInvitationUseCase`
  threw `INVITATION_EXPIRED` for ANY non-pending, non-accepted invitation; the
  entity's `accept()` already distinguished revoked (INVITATION_REVOKED) but the
  use case bypassed it. Now it throws `INVITATION_REVOKED` (new constant) when
  `revokedAt` is set; `invitationErrorKey` maps it to the new
  `invitations.errors.revoked` key.
- **Tests:** unit specs updated for `currentUserRoleKey` (incl. positive
  owner-demotes- owner and admin-rejected cases) + new
  `revoke-invitation.use-case.spec.ts` (pending revoke, already-revoked/accepted
  409s, not-found 404, RLS-bound read). Integration tests: admin cannot
  demote/remove an owner even with 2 owners (AUTHZ-2), last-owner removal passes
  roleKey so AUTHZ-1 is what fires, revoked invite cannot be re-accepted
  (INVITATION_REVOKED) + re-invite works (AUTHZ-8), removed-member re-invite
  passes roleKey. Web: members page tests updated (plain member now sees
  AccessDenied) + invitation-manager tests (statuses, copy/revoke only for
  pending, revoke calls the API + invalidates + shows notice, confirm-decline
  aborts, invite-but-not-remove role still sees revoke — backend parity) +
  revoke error-key tests (alreadyRevoked / alreadyAccepted / 404 / fallback) +
  INVITATION_REVOKED accept mapping. i18n keys in en/ar/fr/es
  (invitationStatus._, revokeInvitation, confirmRevoke, invitationRevoked,
  accessDenied._, members.errors.onlyOwnerDemote/onlyOwnerRemove,
  invitations.errors.revoked); i18n package rebuilt so `dist/` carries the new
  keys (stale-dist gotcha caught by the web tests).
- **Validation:** API + web typecheck ✓; memberships unit specs 67/67 ✓; web
  members + error-keys tests 36/36 ✓ (full web suite 88/88) ✓; memberships
  integration 11/11 ✓ (real Postgres + RLS); lint 0 errors on all changed files
  ✓; code-reviewed twice (owner-guard claims model, revoke RLS/validation order,
  revoked-vs-expired contract, i18n parity, canRemove→canInvite revoke-button
  parity).

### Session 12 — switch-org RLS empty-claims bug (the "why do tests pass but the app is broken" one)

- **Symptom:** after login (and after the ShellLayout auto-select), the sidebar
  STILL hid Members/Roles/Billing and the members-page role dropdown stayed
  absent — even for an OWNER. The unit tests passed because they mock the
  session layer, so they could never catch it.
- **Proof:** a live HTTP flow test against the running dev API (signup → login →
  create org → switch-org) showed `SWITCH-ORG 201` minting a token with
  `roles: []`, `permissions: []` even for the org OWNER — empty claims → the
  AUTHZ-5 `hasPermission` gating hides everything.
- **Root cause (RLS fail-closed in switch-org):** a fresh login token carries NO
  `organizationId` (login is a `@PublicRoute`), so `SwitchOrgUseCase`'s role
  lookup via `txManager.run()` binds only `app.current_user_id`.
  `core_roles`/`core_role_permissions` are protected by the ORG-based
  `tenant_isolation` RLS policy (no `user_own_*` equivalent for roles — unlike
  `core_memberships` which has policy 0007), so `resolveRolePermissions` failed
  closed to `undefined` → the minted access token got `roles: []` +
  `permissions: []`. The membership check (`findByUserAndOrg`) passed because of
  policy 0007; only the role resolution broke.
- **Fix:** the role resolution now runs inside
  `txManager.runWithOrg(newOrganizationId, …)` (the same helper the
  accept-invitation flow uses), which binds `app.current_organization_id`
  explicitly even when the token has no org. The membership check still gates
  access, so no security exposure — the role row read belongs to the verified
  org.
- **Why the old tests masked it:** `switch-org.use-case.spec.ts` mocks the
  repository (never touches RLS); `memberships.integration.test.ts` resolved
  roles with an ORG-BOUND context. Neither exercised the fresh-login org-less
  path.
- **Tests added:** (1) unit spec now mocks `runWithOrg` and pins
  `runWithOrg('org-1', fn)` for the role lookup; (2) integration regression
  `AUTHZ-5: role resolution works from an ORG-LESS token context` — asserts
  `txManager.run` fails closed (undefined) while `runWithOrg(orgId)` resolves
  the owner/member roles against real Postgres + RLS.
- **Validation:** API typecheck ✓, switch-org spec 8/8 ✓, memberships
  integration 9/9 ✓, changed files lint 0 errors ✓, live runtime flow test now
  mints `roles: ["owner"]` + 15 permissions incl. `platform:members:invite` /
  `platform:roles:manage` / `platform:billing:manage` ✓.
- **⚠️ Re-login required for existing sessions:** a user who already switched
  orgs under the broken code has an org-scoped token with EMPTY claims stored in
  the session record, so token refresh re-mints the same empty claims (snapshot
  semantics). The ShellLayout auto-select only fires when
  `organizationId === null`, so it can't rescue them. After this fix, log out/in
  (or switch orgs once) to mint a correctly-claimed token.

### Session 11 — follow-up (final)

- **Sidebar gating regression (Members/Roles/Billing missing after login) —
  PERSISTED after the dashboard-only fix.** Manual testing showed the sidebar
  still hid Members/Roles/Billing after a fresh login (they were only reachable
  via deep links like `/en/settings/members`), and the members page role-change
  dropdown was missing even for an OWNER.
- **Root cause (two layers):** (1) login mints an org-less, permission-less
  access token (login is a `@PublicRoute` with no tenant context; claims are
  only minted at switch-org), so the AUTHZ-5 `hasPermission` gating hides the
  admin UI; (2) the auto-select fix lived ONLY on the dashboard page — a direct
  `/settings/*` navigation or refresh never re-minted the token, so the user
  stayed org-less with empty permissions and the sidebar + role dropdown stayed
  hidden.
- **Fix (final):** moved the auto-select-first-org logic from the dashboard page
  into **`ShellLayout`**, which wraps EVERY authenticated `(dashboard)` route —
  so a deep link to `/settings/members` (or any dashboard route) with an
  org-less token now auto-switches into the user's FIRST org via the existing
  switch-org flow, which re-issues the token with the member's role key +
  effective permissions. Guard discipline preserved: early-return (no guard)
  while the membership query is pending (a slow network can't permanently
  suppress auto-select); resolved-empty = brand-new user → stays on the
  create-org form; guard reset on switchOrg failure for retry. Dashboard page no
  longer auto-selects (ShellLayout owns it).
- **Tests:** `shell-layout-auto-select.test.tsx` (3 tests — deep-link
  `/settings/members` auto-switches to first org; brand-new user no switch;
  pending query ≠ new user, no switch); `dashboard-auto-select.test.tsx` (1 test
  — dashboard renders create-org form, ShellLayout owns the switch);
  `members-role-dropdown.test.tsx` (2 tests — owner with assign-role sees the
  invite + per-member role selects; plain member sees none). The members test
  asserts the email with a regex matcher because the page renders it inside a
  combined text node. Web suite now **77 tests**, typecheck clean, changed files
  lint 0 errors (only pre-existing max-lines warnings); code-reviewed (query-key
  switch, combobox assertion, mock typing).

### Session 11

- **Roles & permissions enforcement — systemic authorization gap fixed** (found
  by manual testing: a member could change roles / remove members).
- **Root cause (3 layers):** (1) every access token was minted with `roles: []`
  and `permissions: []` (login, switch-org, and refresh), so `PermissionGuard`
  (which reads `request.user.permissions`) had nothing to check; (2) no
  controller in the codebase used `@RequiresPermission` — the declarative guard
  stack (AUTHZ-5) existed and was unit-tested but was never wired to any
  endpoint; (3) the `member` role matrix was already correct (only
  `platform:data:read/write`) but nothing enforced it.
- **Fix part 1 — tokens carry authz claims:** `MembershipRepository` gains
  `resolveRolePermissions()` (port + drizzle impl) returning the role key,
  `isSystem` flag, and effective permissions; `SwitchOrgUseCase` now resolves
  the member's role at switch time and embeds `roles: [roleKey]` + effective
  permissions in the access token (system roles via `SYSTEM_ROLE_PERMISSIONS`,
  custom roles via persisted `core_role_permissions` rows).
- **Fix part 2 — refresh path:** the reviewer's critical finding — a refreshed
  access token (every 15 min) would have re-minted empty claims and 403'd every
  guarded endpoint. `generateRefreshToken` now accepts optional org/roles/
  permissions claims and stores them on the session; `refreshAccessToken`
  re-mints the SAME org + claims instead of hardcoding empty arrays (`Session`
  interface gains optional `organizationId`/`roles`/`permissions`). Snapshot
  semantics documented: role changes take effect on next token issuance.
- **Fix part 3 — guards wired:** `@RequiresPermission` added per
  BUSINESS_RULES.md §3 role matrix to memberships (invite/remove/update-role +
  new `platform:members:assign-role` permission added to OWNER/ADMIN matrix),
  roles (create/update/delete/assign-role/transfer-ownership), organizations
  (delete/cancel-deletion/settings), billing (subscription/trial/disable/
  reconcile), audit-log (view), and module-registry (enable/disable)
  controllers.
- **Fix part 4 — frontend gating:** members page hides invite / role-change /
  remove controls for users without the permissions; sidebar + settings hub hide
  members/roles/billing nav items for members (existing `hasPermission` helper).
- **Fix part 5 — session revocation (reviewer follow-up, closes stale-claims
  windows):** (a) `UpdateMembershipRoleUseCase` / `RemoveMemberUseCase` now call
  `jwtTokenService.revokeAllUserSessions(target, 'ROLE_CHANGED'/'MEMBER_REMOVED')`
  AFTER the write commits — a demoted owner's refresh token can no longer
  re-mint the old elevated permissions from the session snapshot; (b)
  `SwitchOrgUseCase` takes the current `sessionId` and revokes the previous
  session (`'ORG_SWITCHED'`, best-effort try/catch — a store outage never fails
  the switch; `exactOptionalPropertyTypes`-safe conditional spread in the
  controller). Note: revocation is org-agnostic for now (in-memory store); a
  per-org session key would let it be scoped later. Login still mints empty
  claims by design (login is `@PublicRoute` with no tenant context — RLS-scoped
  membership resolution is unavailable there); org selection + claim minting
  happens via the existing switch-org flow.
- **Tests:** `switch-org.use-case.spec.ts` now 8 tests (role key + system/custom
  perms, empty fallback, session revocation, no self-revoke, best-effort
  failure); `update-membership-role` 9 tests + `remove-member` 9 tests (revoke
  with right reason, no revoke on rejected ops). Integration tests instantiate
  the two use cases with a `sessionRevokerStub` (revocation is out of scope for
  the DB-focused suite). Validation: API typecheck clean, **1045/1045 API unit
  tests**, memberships integration **8/8** (real Postgres + RLS), all changed
  files lint clean (remaining API lint errors pre-existing in untouched files).

### Session 10

- **Re-invite/re-accept 500 bug (removed member rejoining):** removing a member
  soft-deletes their `core_memberships` row (AUTHZ-7) but the table's hard
  `UNIQUE (organization_id, user_id)` constraint kept the tombstone.
  Re-accepting a new invitation ran `findByUserAndOrg` (filters
  `deleted_at IS NULL` → old row invisible, invite allowed) then tried to INSERT
  a fresh membership for the same (org, user) → unique violation → HTTP 500
  "Could not accept the invitation" (sign-up path dead-ends too: the email field
  is locked to the existing account).
- **Fix:** forward-only migration `0011_membership_partial_unique.sql` drops the
  full-column constraint and replaces it with partial unique index
  `uq_core_memberships_active` (`organization_id, user_id`)
  `WHERE deleted_at IS NULL` — preserves "at most one ACTIVE membership per
  (org, user)" while letting a soft-deleted row coexist with a new active one
  after re-accept. No application code changes needed: `findByUserAndOrg`, the
  members list, and the org switcher all already filter `deleted_at IS NULL`;
  the accept INSERT runs inside `runWithOrg` (RLS `WITH CHECK` satisfied).
  `docs/DATA_MODEL.md` §4.2 `core_memberships` row updated to document the
  partial index.
- **Integration regression added** (`memberships.integration.test.ts`): invite →
  accept → remove → re-invite (AUTHZ-8 passes — no active membership) →
  re-accept (no 500), then asserts two rows exist (old inactive+deleted, new
  active with the NEW invitation's role) and the members list shows exactly one
  active membership. 7/7 tests pass in a fresh Testcontainers Postgres running
  all migrations (incl. 0011).
- **Validation:** dev DB migrated (0011 applied; index verified partial;
  existing soft-deleted row unaffected), memberships integration 7/7,
  organizations integration 12/12, API unit suite 1033/1033, API typecheck
  clean.

### Session 9

- **Member-management bugs found by manual testing** (three issues, two root
  causes):
  - **Bug 1/2 (404 on role change & member removal):**
    `UpdateMembershipRoleUseCase` and `RemoveMemberUseCase` read the membership
    with `membershipRepo.findById()` **outside** `txManager.run()`.
    `core_memberships` has `FORCE ROW LEVEL SECURITY` with the
    `tenant_isolation` policy, so reads on the pool connection fail closed to
    zero rows → `MEMBERSHIP_NOT_FOUND` (404) → "This member is no longer part of
    the organization." Same bug class as the billing reads fixed in Session 8's
    follow-up. Fix: wrap the read in `txManager.run((tx) => findById(id, tx))`
    (matching `assign-role`/`update-role`/ `delete-role` precedent).
  - **AUTHZ-1 guard corrected:** the last-owner guard previously counted members
    with the _same role_ (`countByOrgIdAndRoleId(org, membership.roleId) <= 1`),
    which would have blocked re-roling the only member of ANY role (e.g. the
    only 'member'). Now it fires only for the OWNER role — `findById` LEFT JOINs
    `core_roles` to expose `roleKey` (`MembershipData.roleKey`, optional,
    exactOptionalPropertyTypes-safe conditional spread). Members holding
    non-owner roles are freely demotable/removable; only the last OWNER is
    protected (AUTHZ-1).
  - **Bug 3 (role dropdown missing admin/manager/member/viewer):** org creation
    seeded only the OWNER system role, so the DB-backed `getRoles` dropdown
    (members page + invite form) listed only owner + custom roles, while the
    role-matrix page synthesized all 5 from constants. Fix:
    `CreateOrganizationUseCase` now seeds all five system roles
    (`SYSTEM_ROLE_SEED` constant in roles domain — nameI18n in en/ar/fr/es) +
    the OWNER membership; forward-only migration `0010_seed_system_roles.sql`
    backfills existing orgs idempotently (NOT EXISTS per org+key).
  - **Members page role select:** `disabled={currentRole?.isSystem}` would have
    disabled the dropdown for EVERY member once all 5 roles are system roles —
    changed to `disabled={member.userId === user?.id}` (AUTHZ-3: can't change
    your own role; backend enforces last-owner).
  - **Tests:** org-creation unit spec updated (5 roles, localized names, OWNER
    membership references OWNER role); organizations integration test asserts
    all 5 system roles; memberships integration test adds RLS regression
    coverage for role-change + removal (invitee as actor so AUTHZ-3 doesn't fire
    before AUTHZ-1), plus last-owner demote/remove and own-role guards. E2E
    updated: invite-role now has 6 options (placeholder + 5 roles), selects
    'Member' by label.
  - **Validation:** API 1018 unit tests, web 71 tests, memberships+organizations
    integration 18/18 (real Postgres + RLS), Playwright E2E passes against the
    live stack; typecheck clean; all modified files lint clean (remaining API
    lint errors are pre-existing in untouched files). Dev DB migrated (0010
    applied — every org now has the full role set).

### Session 8

- **Invitation-accept 404 bug (email mismatch):** the invite link carried only
  the invitation UUID, so the invitee could sign up with a _different_ email
  than the one invited. The `user_own_invitations` RLS policy (0009) only
  exposes an invitation to an account whose email equals the invited email, so
  the accept call failed closed with `NotFoundError` (404) → generic "Could not
  accept".
- **Session 8 follow-up (still 404 after the email lock):** the code fix was
  correct, but the **local dev DB had never applied migration 0009** (only
  0001–0008 were present) — so `core_invitations` had only `tenant_isolation`
  and a freshly signed-up invitee (token with no org) read the invitation
  fail-closed. Ran `pnpm db:migrate`; verified the full accept flow returns 201
  end-to-end over the real API (signup owner → org → switch-org → invite →
  signup invitee → login → accept).
- **Playwright E2E added:** `@playwright/test` devDep + `test:e2e` script +
  `apps/web/playwright.config.ts` (testDir `./e2e`, webServer reuse for the
  running api/web, chromium project) + `e2e/invitation-flow.e2e.spec.ts`
  covering the full journey: owner signup → login → create org → invite
  (invitationId captured from the API response) → copy invite link (clipboard
  carries id + `?email=`) → invitee signed-out → Create account CTA → signup
  with the locked email → login (email prefilled) → auto-accept → success
  message → dashboard redirect. Passes against the live dev stack; `.gitignore`
  updated for Playwright artifacts.
- **Fix (flow):** invite links now carry `?email=` (members page copies it); the
  invitation page passes it to signup/login; `SignupForm` pre-fills **and
  locks** the email field (AUTH-3/AUTH-9: the invited address is the binding
  identity) with an `emailLockedHint`; `LoginForm` pre-fills it; the
  signup→login hop preserves it.
- **Invitation page state machine:** the accept-decision effect reads `?email=`
  synchronously and compares it to the session email before firing the accept
  call — no session → `needsAccount` (signup/login CTAs with `next` return
  path); session email mismatch → new `wrongAccount` state with a logout CTA (a
  logged-in user can't reach the auth routes — middleware bounces them — so
  logout is the escape hatch); accept 401 → `await logout()` drops the stale
  session so the cookie is cleared before the `needsAccount` CTAs render (no
  middleware dead-end); other failures → typed error via `invitationErrorKey()`.
- **AUTH-3 (backend):** `AcceptInvitationUseCase` now marks the invitee's email
  verified (`email_verified_at`) when the invitation is accepted — accepting
  implicitly verifies the address, per BUSINESS_RULES.md AUTH-3. Runs inside the
  invitation-org transaction (`runWithOrg`).
- New i18n keys `invitations.invitedAs`, `invitations.wrongAccountTitle`,
  `invitations.wrongAccountSubtitle` + `auth.emailLockedHint` in en/ar/fr/es.
- Tests: 3 new auth-form tests (login pre-fill, signup lock + hint, signup→login
  email carry-through) + `invitation-page.test.tsx` (5 tests: matching email
  fires accept, mismatched email routes to wrongAccount, logout escape hatch,
  signed-out needsAccount, email carried into signup/login hrefs); integration
  test asserts the explicit null → Date `email_verified_at` transition after
  accept (not vacuous). Web suite now 71 tests; web typecheck + lint clean (0
  errors); API 1017 tests green; memberships integration suite green.

### Session 7

- Phase 2 verification — fixed two member-invitation flow bugs found by manual
  testing of the frontend shell
- **Bug 1 (409 on invite to existing email):** backend rejection was correct
  (AUTHZ-8: `MEMBERSHIP_ALREADY_EXISTS` / `INVITATION_ALREADY_PENDING`), but the
  members page collapsed every error into the generic "Could not send the
  invitation". Added `inviteErrorKey()` mapper
  (`apps/web/src/lib/api/error-keys.ts`) and specific
  `members.errors.alreadyMember` / `alreadyPending` i18n keys in en/ar/fr/es.
- **Bug 2 (401 on accepting an invitation):** accept endpoint requires JWT auth
  (invitee must be signed in with the invited email — RLS policy 0009), but the
  invitation page fired the accept call on mount regardless of session. Rewrote
  `(auth)/invitations/[id]/page.tsx` to gate on the stored token: no session →
  `needsAccount` state with signup/login CTAs carrying a `next` return path; 401
  mid-flight → same state; `MEMBERSHIP_ALREADY_EXISTS` (409, e.g. inviter
  opening own link) → specific message.
- **Redirect flow:** `LoginForm`/`SignupForm` accept a sanitized `next` prop;
  login/signup pages read `searchParams.next` (with `typeof` guard for Next 15
  `string[]`); `safeNextPath()` rejects absolute/protocol-relative/backslash
  URLs (open-redirect guard).
- New tests: `error-keys.test.ts` (12 tests incl. open-redirect cases) + 2
  auth-form tests for the `next` redirect; web suite now 52 tests, typecheck +
  lint clean.

### Session 1

- Monorepo config files (pnpm-workspace, turbo, docker-compose)

### Session 2

- Phase 0.2: All 9 shared package skeletons
- Phase 0.3: App skeletons (NestJS 11 + Fastify, Next.js 15 + next-intl)
- Phase 0.4: Quality tooling (ESLint, Prettier, Husky, commitlint, lint-staged,
  Vitest, depcruise)

### Session 3

- Phase 0.4-0.7: ESLint, CI/CD, .env.example, architecture tests
- Phase 0 DoD verification

### Session 4

- Phase 1.1: Database foundation (Drizzle provider, TransactionManager,
  Repository base, UnitOfWork)
- Phase 1.2: Tenancy (TenantContext, middleware, system-context decorator)
- Phase 1.3: Auth (JWT tokens, refresh rotation, session store, Passport
  strategies)
- Phase 1.4: Authorization (CASL factory, guards, decorators)
- Phase 1.5: Entitlements (state machine, entitlement guard)
- Phase 1.6: Events (EventBus, EventEmitter2 adapter, listener decorator,
  outbox)
- Phase 1.7: Money (Money VO, currency registry, property-based tests)
- Phase 1.8: i18n (locale resolution, formatters, 4-language catalogs)
- Phase 1.9: Audit (AuditLogger, interceptor, redaction)
- Phase 1.10: Observability (Pino, correlation ID, OTEL, Sentry)
- Phase 1.11: Cache, Jobs, Storage, Notifications
- Phase 1.12: Common (error model, exception filters, interceptors)
- Integration tests: TEN-1, TEN-3, AUTH-2, AUTH-4, AUTH-8, OPS-3 (32 tests)
- Coverage: targeted edge-case tests pushed auth branches 72.88% → 86.76%,
  audit-logger branches 90.9% → 95.74%
- Phase 1 DoD verification: all 15 criteria met

### Session 6

- Phase 2 verification: audited frontend shell against PLAN.md §2.9 spec
- Fixed typecheck error in `create-organization.use-case.spec.ts` (TS18048
  possibly undefined on mock.calls)
- Fixed lint error in `forgot-password/page.tsx` (nested ternary `as` cast →
  explicit if/else)
- Added `eslint-disable` with justification for `next.config.ts` `as const`
  (unavoidable literal narrowing)
- Added invitation acceptance page:
  `apps/web/src/app/[locale]/(auth)/invitations/[id]/page.tsx`
- Added `invitations` i18n section to all four locale catalogs (en, ar, fr, es)
- Updated middleware to allow `/invitations/` routes without auth
- **623 total tests (587 API + 36 web), 35 test files — all passing**
- `pnpm typecheck`: clean (0 errors)
- `pnpm test:arch`: 0 errors (280 pre-existing orphan warnings)
- Web lint: 0 errors (24 pre-existing max-lines/complexity warnings on large UI
  components)

### Session 5

- Phase 2 audit: discovered `platform/audit-log` and `platform/fx-rates` had
  **zero test coverage**; many business rules untested (AUTH-10, AUTHZ-3,
  AUTHZ-9, BILL-1/2/5/8/9/13, CUR-6, TEN-4)
- **Option chosen**: Full DoD compliance — wrote new tests for all uncovered
  platform areas
- Created `query-audit-log.use-case.spec.ts` — 8 tests: pagination defaults,
  actor/entity/action/date-range filters, missing optional filters
- Created `get-fx-rate.use-case.spec.ts` — 9 tests: **CUR-6** prior-snapshot
  fallback, unknown currencies, rate-not-found edge cases
- Created `snapshot-fx-rates.use-case.spec.ts` — 7 tests: pair generation,
  self-pair skip, single-currency edge cases, none-skip
- Fixed `import type { AppError }` lint error in get-fx-rate test
- **994 tests, 48 files, all passing** — unit test suite green
- **pnpm typecheck** passes cleanly
- **pnpm test:arch** — 0 errors (153 pre-existing orphan/coverage warnings)
- **pnpm lint** — API errors fixed; remaining 27 errors all pre-existing (web)
- Integration tests started but vitest v3 workspace auto-discovery interferes;
  Docker (Postgres 16 + Redis 7) is running
- PROGRESS.md updated with Phase 2 DoD checklist showing ⚠️ items needing
  integration/E2E tests
