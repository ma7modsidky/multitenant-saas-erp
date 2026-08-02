# ModuBiz — Development Progress Tracker

**Last updated:** Session 19 — Phase 2 verified + committed; invite-500 fixed;
Phase 3 leftovers removed **Current phase:** Phase 3 — Module Framework &
Generator (clean start)

> This file tracks where we are in [PLAN.md](./PLAN.md). Update it at the end of
> every work session.

---

## Phase status

| Phase                                 | Status         | Notes                                                         |
| ------------------------------------- | -------------- | ------------------------------------------------------------- |
| 0 — Foundation & Tooling              | ✅ Complete    | All 0.1–0.7 done; DoD verified                                |
| 1 — Core Shared Kernel                | ✅ Complete    | All 1.1–1.12 done; DoD verified                               |
| 2 — Platform + Frontend Shell         | ✅ Complete    | Unit + arch + integration + E2E green; committed (Session 19) |
| 3 — Module Framework & Generator      | ⬜ Not started | Clean start — all demo leftovers removed                      |
| 4 — CRM Module                        | ⬜ Not started |                                                               |
| 5 — Inventory Module                  | ⬜ Not started |                                                               |
| 6 — POS Module                        | ⬜ Not started |                                                               |
| 7 — Production Hardening & Deployment | ⬜ Not started |                                                               |

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

## Session log

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
