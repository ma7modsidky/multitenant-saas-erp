# ModuBiz — Technology Stack

**Status:** Locked. Version 1.0.

Every row in this document is a **decision, not an option**. If you believe a
decision is wrong, open an ADR proposal and get it changed here first — do not
introduce an alternative in code.

---

## 1. Architecture style

**Modular monolith**, single deployable API, with module boundaries enforced
strictly enough that any module can be extracted into its own service later
without rewriting its domain logic.

We deliberately do **not** start with microservices: at our scale they would add
distributed-systems cost with no benefit. See
[ARCHITECTURE.md §10](./ARCHITECTURE.md#10-path-to-extraction) for the
extraction path.

---

## 2. The locked stack

| Layer                  | Choice                                                                                                         | Version policy        | Notes                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| Package manager        | **pnpm**                                                                                                       | ≥ 9                   | Workspaces; `pnpm-lock.yaml` committed                                              |
| Monorepo orchestration | **Turborepo**                                                                                                  | ≥ 2                   | Task graph + remote cache                                                           |
| Language               | **TypeScript**                                                                                                 | ≥ 5.6, `strict: true` | No `any` without an inline justification comment                                    |
| Backend framework      | **NestJS**                                                                                                     | 11.x                  | Native module system is the backbone of the product                                 |
| Runtime                | **Node.js**                                                                                                    | 22 LTS                | Pinned via `.nvmrc` and Docker base image                                           |
| HTTP adapter           | **Fastify** (`@nestjs/platform-fastify`)                                                                       | matches Nest 11       | Chosen over Express for throughput                                                  |
| Database               | **PostgreSQL**                                                                                                 | 16+                   | Managed (Neon / Supabase / Railway); RLS is mandatory                               |
| ORM / query layer      | **Drizzle ORM**                                                                                                | latest stable         | SQL-first, transparent, best fit for RLS + `SET LOCAL`                              |
| Migrations             | **drizzle-kit** + hand-written SQL for RLS policies                                                            | —                     | Migrations are owned per module                                                     |
| Validation             | **Zod** at all boundaries                                                                                      | ≥ 3                   | Single validation library; `nestjs-zod` for DTO/OpenAPI bridging                    |
| API style              | **REST + OpenAPI 3.1** (`@nestjs/swagger`)                                                                     | —                     | Typed client generated into `@modubiz/api-client`                                   |
| Auth                   | **NestJS + Passport**, self-hosted                                                                             | —                     | JWT access (15 min) + rotating refresh (30 d), argon2id password hashing            |
| Authorization          | **CASL** + Nest guards/decorators                                                                              | ≥ 6                   | `@RequiresModule()`, `@RequiresPermission()`                                        |
| Billing                | **Stripe** (Subscriptions + Webhooks)                                                                          | API pinned            | Base plan + per-module subscription items                                           |
| In-process events      | **`@nestjs/event-emitter`** (EventEmitter2)                                                                    | —                     | Default cross-module integration mechanism                                          |
| Queues / async jobs    | **BullMQ + Redis**                                                                                             | ≥ 5                   | Emails, trial expiry, reconciliation, exports, POS sync                             |
| Cache                  | **Redis** (`ioredis`)                                                                                          | ≥ 7                   | Tenant-namespaced keys only                                                         |
| Real-time              | **Socket.IO** Nest gateway                                                                                     | ≥ 4                   | Not used in MVP beyond POS shift/stock pushes; required by Food Delivery later      |
| Frontend framework     | **Next.js** App Router                                                                                         | 15.x                  | React Server Components where they help; client components for interactive surfaces |
| UI runtime             | **React**                                                                                                      | 19.x                  | —                                                                                   |
| Styling                | **Tailwind CSS**                                                                                               | ≥ 3.4                 | Logical properties only (RTL-safe)                                                  |
| Component library      | **shadcn/ui** + Radix primitives                                                                               | —                     | Components vendored into `@modubiz/ui`                                              |
| Client data layer      | **TanStack Query**                                                                                             | ≥ 5                   | Wrapping the generated OpenAPI client                                               |
| Forms                  | **react-hook-form** + Zod resolver                                                                             | —                     | Schemas shared with the backend via `@modubiz/contracts`                            |
| Frontend i18n          | **next-intl**                                                                                                  | ≥ 3                   | Catalogs in `@modubiz/i18n`; `dir` derived from locale                              |
| Backend i18n           | **`nestjs-i18n`** (system messages only)                                                                       | —                     | API returns codes; templates/receipts are rendered server-side                      |
| File storage           | **Cloudflare R2** (S3-compatible SDK)                                                                          | —                     | Presigned uploads; no file bytes through the API                                    |
| Email                  | **Resend**                                                                                                     | —                     | React Email templates, per-locale                                                   |
| Error tracking         | **Sentry** (API + web)                                                                                         | —                     | Org id and correlation id on every event                                            |
| Tracing / metrics      | **OpenTelemetry** → OTLP collector; **Prometheus** metrics endpoint                                            | —                     | Grafana dashboards                                                                  |
| Logging                | **Pino** (`nestjs-pino`)                                                                                       | —                     | Structured JSON, always with `correlationId` + `organizationId`                     |
| Product analytics      | **PostHog**                                                                                                    | —                     | Funnels for trial conversion and time-to-value                                      |
| Testing                | **Vitest** (unit/integration), **Supertest** (HTTP), **Playwright** (e2e), **Testcontainers** (Postgres/Redis) | —                     | See [TESTING.md](./TESTING.md)                                                      |
| Lint / format          | **ESLint** (flat config) + **Prettier**                                                                        | —                     | Custom boundary rules, see [CODING_STANDARDS.md](./CODING_STANDARDS.md)             |
| Git hooks              | **Husky** + **lint-staged** + **commitlint**                                                                   | —                     | Conventional Commits enforced                                                       |
| CI/CD                  | **GitHub Actions** + Docker (multi-stage, distroless runtime)                                                  | —                     | Gates defined in [TESTING.md §8](./TESTING.md#8-ci-pipeline-and-merge-gates)        |
| Hosting (initial)      | API on **Railway/Fly.io**, web on **Vercel**, DB managed Postgres                                              | —                     | Kubernetes only if/when justified                                                   |
| IaC                    | **Terraform** — deferred until post-MVP                                                                        | —                     | Manual, documented setup until then                                                 |

---

## 3. Decision rationale and rejected alternatives

| Decision                                         | Why                                                                                                                                                                                                                        | Rejected alternative                     | Why rejected                                                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drizzle ORM**                                  | SQL-first and transparent, so RLS, `SET LOCAL`, CTEs, and window functions are natural. Schema is plain TypeScript, so a module can own its schema file. Trivial to keep every query inside one tenant-scoped transaction. | **Prisma**                               | Its connection/engine model fights transaction-scoped session variables, making per-request RLS awkward; less control over generated SQL; heavier migration model that resists per-module ownership. |
| **Turborepo**                                    | Minimal, fast, unopinionated; we want our own module generator anyway.                                                                                                                                                     | **Nx**                                   | Powerful generators but heavy conventions and plugin coupling; our module scaffolding needs are project-specific and small.                                                                          |
| **Self-hosted Passport auth**                    | Full control over the org/membership model, session revocation, and org switching; no per-MAU cost; auth data lives in our database next to tenancy data.                                                                  | **Clerk Organizations**                  | Vendor lock-in on the most core domain concept (organizations = tenants), per-MAU cost that scales with a low-ARPU SMB segment, and a hard boundary between billing entitlements and identity.       |
| **REST + OpenAPI + generated client**            | One contract that serves the web app, future mobile/POS clients, and customer integrations. Keeps modules decoupled — no shared server router type.                                                                        | **tRPC**                                 | Couples the frontend build to backend internals, does not produce a public contract, and does not survive extracting a module into another service.                                                  |
| **Zod everywhere**                               | One validation mental model shared between backend DTOs and frontend forms.                                                                                                                                                | **class-validator**                      | Decorator-based schemas cannot be shared with the frontend and compose poorly.                                                                                                                       |
| **Fastify adapter**                              | Higher throughput, lower overhead, first-class Nest support.                                                                                                                                                               | **Express**                              | Slower; no compelling advantage.                                                                                                                                                                     |
| **EventEmitter2 first, BullMQ for durable work** | In-process events are simple and fast; durable work belongs in a queue with retries. Both are behind our own `EventBus` abstraction so the transport can change.                                                           | **Kafka / Redis Streams from day one**   | Operational cost with no current requirement.                                                                                                                                                        |
| **Modular monolith**                             | Team size and traffic do not justify distributed systems. Boundaries are enforced by tests, so the option to split stays open.                                                                                             | **Microservices from day one**           | Would consume the entire MVP budget on infrastructure.                                                                                                                                               |
| **Integer minor units for money**                | Exact arithmetic, database-native, language-agnostic.                                                                                                                                                                      | **`numeric`/`decimal` columns or float** | Float is incorrect for money; `numeric` invites accidental JS `number` coercion in the driver.                                                                                                       |

---

## 4. Version and dependency policy

1. Pin exact versions for `nestjs`, `next`, `react`, `drizzle-orm`, `stripe`,
   and the Node base image. Caret ranges are allowed elsewhere.
2. Renovate/Dependabot opens grouped weekly PRs. Majors are handled
   deliberately, never auto-merged.
3. `pnpm-lock.yaml` is always committed. CI installs with `--frozen-lockfile`.
4. **Adding a new runtime dependency requires justification in the PR
   description**, and must not duplicate a capability already in this table (no
   second HTTP client, date library, validation library, or state manager).
5. Approved utility set: `date-fns-tz` (dates), `nanoid` (public ids), `argon2`
   (hashing), `pino` (logging). Nothing else without review.

---

## 5. Environment variables

Declared once with a Zod schema in `packages/config` and validated at boot.
**The application must refuse to start if validation fails.** No `process.env`
access anywhere except inside `packages/config`.

### Backend (`apps/api`)

| Variable                                                                 | Required | Example / notes                                  |
| ------------------------------------------------------------------------ | -------- | ------------------------------------------------ |
| `NODE_ENV`                                                               | yes      | `development` \| `test` \| `production`          |
| `PORT`                                                                   | yes      | `4000`                                           |
| `API_BASE_URL`                                                           | yes      | Public URL of the API                            |
| `WEB_BASE_URL`                                                           | yes      | Used for links in emails and CORS allowlist      |
| `DATABASE_URL`                                                           | yes      | Connects as the **non-owner** `modubiz_app` role |
| `DATABASE_MIGRATION_URL`                                                 | yes      | Owner role; used only by the migration runner    |
| `DATABASE_POOL_MAX`                                                      | no       | Default `10`                                     |
| `REDIS_URL`                                                              | yes      | Cache + BullMQ                                   |
| `JWT_ACCESS_SECRET`                                                      | yes      | ≥ 32 bytes                                       |
| `JWT_REFRESH_SECRET`                                                     | yes      | Distinct from the access secret                  |
| `JWT_ACCESS_TTL`                                                         | no       | Default `15m`                                    |
| `JWT_REFRESH_TTL`                                                        | no       | Default `30d`                                    |
| `STRIPE_SECRET_KEY`                                                      | yes      | —                                                |
| `STRIPE_WEBHOOK_SECRET`                                                  | yes      | —                                                |
| `RESEND_API_KEY`                                                         | yes      | —                                                |
| `EMAIL_FROM`                                                             | yes      | —                                                |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | yes      | S3-compatible storage                            |
| `FX_RATES_PROVIDER_URL`, `FX_RATES_API_KEY`                              | yes      | Daily rate snapshot job                          |
| `SENTRY_DSN`                                                             | prod     | —                                                |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                            | prod     | —                                                |
| `LOG_LEVEL`                                                              | no       | Default `info`                                   |
| `DEFAULT_LOCALE`                                                         | no       | Default `en`                                     |
| `SUPPORTED_LOCALES`                                                      | no       | Default `en,ar,fr,es`                            |
| `TRIAL_DURATION_DAYS`                                                    | no       | Default `14`                                     |

### Frontend (`apps/web`)

| Variable                   | Required | Notes |
| -------------------------- | -------- | ----- |
| `NEXT_PUBLIC_API_BASE_URL` | yes      | —     |
| `NEXT_PUBLIC_APP_URL`      | yes      | —     |
| `NEXT_PUBLIC_POSTHOG_KEY`  | no       | —     |
| `NEXT_PUBLIC_SENTRY_DSN`   | no       | —     |

**Rules:** never commit a real `.env`; keep `.env.example` exhaustive and in
sync; only genuinely public values may use the `NEXT_PUBLIC_` prefix; secrets
are injected by the platform, never baked into images.

---

## 6. Local development

| Command                                                 | Purpose                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm install`                                          | Install the workspace                                      |
| `pnpm docker:up`                                        | Start Postgres + Redis via `docker-compose`                |
| `pnpm db:migrate`                                       | Apply migrations (owner role)                              |
| `pnpm db:seed`                                          | Seed demo org, users, and module data                      |
| `pnpm dev`                                              | Run API + web via Turborepo                                |
| `pnpm lint` / `pnpm typecheck`                          | Static checks                                              |
| `pnpm test` / `pnpm test:integration` / `pnpm test:e2e` | Test suites                                                |
| `pnpm generate:api-client`                              | Regenerate `@modubiz/api-client` from the OpenAPI document |
| `pnpm generate:module <name>`                           | Scaffold a new module from the canonical skeleton          |

---

## 7. Related documents

[PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) ·
[MODULE_GUIDE.md](./MODULE_GUIDE.md) · [DATA_MODEL.md](./DATA_MODEL.md) ·
[BUSINESS_RULES.md](./BUSINESS_RULES.md) ·
[CODING_STANDARDS.md](./CODING_STANDARDS.md) · [TESTING.md](./TESTING.md)
