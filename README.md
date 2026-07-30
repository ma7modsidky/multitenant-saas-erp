# ModuBiz

A multi-tenant, modular SaaS platform for small and medium businesses. Subscribe to a lightweight core, then switch on only the business applications you need — CRM, Inventory, Point of Sale, and more over time.

Think of it as a modern, opinionated alternative to Odoo: far simpler, genuinely multi-language (including RTL) and multi-currency from day one, and architected so that adding the tenth module is as cheap as adding the third.

> **Status: documentation phase.** The stack and architecture are locked; implementation has not started.
> **AI agents and new contributors: read [AGENTS.md](./AGENTS.md) first.**

---

## Stack at a glance

| | |
|---|---|
| **Architecture** | Modular monolith, extractable to services |
| **Backend** | NestJS 11 · TypeScript · Fastify |
| **Database** | PostgreSQL 16 · Drizzle ORM · Row-Level Security |
| **Frontend** | Next.js 15 App Router · React 19 · Tailwind · shadcn/ui |
| **API** | REST + OpenAPI 3.1 with a generated typed client |
| **Auth** | Self-hosted: Passport · JWT access + rotating refresh · CASL |
| **Billing** | Stripe — base plan + per-module subscription items, 14-day trial per module |
| **Async** | EventEmitter2 (in-process) · BullMQ + Redis (durable) |
| **Monorepo** | Turborepo + pnpm |

Full detail, including rejected alternatives: [docs/TECH_STACK.md](./docs/TECH_STACK.md).

---

## Modules

| Module | Key | Status | Depends on |
|---|---|---|---|
| Platform core (orgs, users, RBAC, billing, audit, i18n) | — | MVP | — |
| CRM | `crm` | MVP | — |
| Inventory | `inventory` | MVP | — |
| Point of Sale | `pos` | MVP | `inventory` |
| E-commerce | `ecommerce` | Planned | `inventory` |
| Food Ordering & Delivery | `food` | Planned | `inventory`, `pos` |
| HR | `hr` | Planned | — |

Adding a module follows [docs/MODULE_GUIDE.md](./docs/MODULE_GUIDE.md) and must require **zero** changes to `apps/api/src/core/`.

---

## Repository map

```
modubiz/
├── apps/
│   ├── api/                  # NestJS modular monolith
│   │   └── src/
│   │       ├── core/         # shared kernel: tenancy, auth, authz, db, events, i18n, money
│   │       ├── platform/     # orgs, users, roles, billing, module registry, audit, search
│   │       └── modules/      # crm, inventory, pos — the bounded contexts
│   └── web/                  # Next.js 15 App Router
├── packages/
│   ├── contracts/            # events, ports, permissions, module keys, shared Zod schemas
│   ├── api-client/           # generated REST client
│   ├── db/                   # Drizzle barrel, migration runner, RLS helpers, seeds
│   ├── config/               # Zod-validated env (the only place reading process.env)
│   ├── money/                # Money value object, currency, rounding, FX
│   ├── i18n/                 # locale catalogs and formatters
│   └── ui/                   # shadcn/ui component library
├── docs/                     # the specification set
├── tooling/generators/       # pnpm generate:module
├── AGENTS.md                 # rules for AI agents and contributors
└── CLAUDE.md                 # pointer to AGENTS.md
```

---

## Quickstart

```bash
pnpm install
cp .env.example .env          # fill in the required values
pnpm docker:up                # Postgres + Redis
pnpm db:migrate
pnpm db:seed                  # demo organization, users, and module data
pnpm dev                      # API on :4000, web on :3000
```

| Command | Purpose |
|---|---|
| `pnpm lint` / `pnpm typecheck` | Static checks |
| `pnpm test` | Unit tests |
| `pnpm test:integration` | Integration + tenant-isolation tests (requires Docker) |
| `pnpm test:arch` | Architecture boundary tests |
| `pnpm test:e2e` | Playwright end-to-end |
| `pnpm generate:module <key>` | Scaffold a new module |
| `pnpm generate:api-client` | Regenerate the typed API client from OpenAPI |

---

## The five ideas that define this codebase

1. **Every business capability is a module** that owns its tables, routes, permissions, events, and price.
2. **Modules never import each other.** They integrate through versioned events, or through an explicitly declared port when strong consistency is genuinely required.
3. **Tenant isolation is enforced by PostgreSQL RLS**, not by application code remembering to filter. Without tenant context, a query returns nothing.
4. **Money is integer minor units plus a currency**, with the FX rate snapshotted onto every converted record. Floating-point money is a defect.
5. **Nothing user-facing is hardcoded English.** The API returns error codes; the UI renders localized copy and works in RTL.

---

## Documentation

| Document | Read it when |
|---|---|
| [AGENTS.md](./AGENTS.md) | **Always first** — hard rules and where to look next |
| [docs/PRD.md](./docs/PRD.md) | Understanding scope, personas, module lifecycle, success metrics |
| [docs/TECH_STACK.md](./docs/TECH_STACK.md) | Choosing a library or wondering why a decision was made |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Deciding where code goes or how modules interact |
| [docs/MODULE_GUIDE.md](./docs/MODULE_GUIDE.md) | Adding a new module |
| [docs/DATA_MODEL.md](./docs/DATA_MODEL.md) | Touching schemas, migrations, tenancy, or money columns |
| [docs/BUSINESS_RULES.md](./docs/BUSINESS_RULES.md) | Implementing a rule, validation, or state transition |
| [docs/CODING_STANDARDS.md](./docs/CODING_STANDARDS.md) | Naming, structuring, or handling errors |
| [docs/TESTING.md](./docs/TESTING.md) | Writing tests or interpreting a CI failure |

---

## License

Proprietary. All rights reserved.
