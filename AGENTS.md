# AGENTS.md — Rules for AI Coding Agents

**Read this file first, every session.** It is the entry point and the rulebook. Human contributors are bound by the same rules.

**Project:** ModuBiz — a multi-tenant, modular SaaS platform (NestJS modular monolith + Next.js) where SMBs subscribe to only the business modules they need.
**Current state:** documentation phase. The stack is decided; implementation has not started.

---

## 1. The ten hard rules

Violating any of these is a defect, regardless of whether tests pass.

| # | Rule |
|---|---|
| 1 | **Never import from another business module's source.** Cross-module needs are met by an event or a declared port in `@modubiz/contracts`. |
| 2 | **Never bypass tenant isolation.** No manual `organizationId` filters, no reading `organizationId` from client input, no database access outside `TransactionManager.run()`. RLS is the real defence. |
| 3 | **Never use floating-point money.** Integer minor units + ISO currency, always via `@modubiz/money`. No `toFixed()` on a monetary value. |
| 4 | **Never hardcode a user-facing string.** Backend returns error codes; the frontend renders i18n keys. |
| 5 | **Never use directional CSS.** Logical utilities only (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`, `text-end`) — the product must work in RTL. |
| 6 | **Never put business logic in a controller.** Controllers validate, delegate to a use case, and map the response. |
| 7 | **Never let the domain layer import a framework.** `domain/` has no Nest, Drizzle, HTTP, or I/O imports. |
| 8 | **Never modify a merged migration** or `UPDATE`/`DELETE` a ledger table (`inv_stock_movements`, `pos_payments`, `core_audit_log`). Fix forward, compensate, append. |
| 9 | **Never read `process.env` outside `packages/config`.** |
| 10 | **Never change behaviour that contradicts a documented business rule** without updating [docs/BUSINESS_RULES.md](./docs/BUSINESS_RULES.md) in the same change. |

---

## 2. Where to look before you write code

| If you are about to… | Read first |
|---|---|
| Add or change a feature's scope | [docs/PRD.md](./docs/PRD.md) |
| Choose a library, tool, or version | [docs/TECH_STACK.md](./docs/TECH_STACK.md) — the stack is locked; do not introduce alternatives |
| Create a file, decide where code goes, or wire modules | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| Add a new module | [docs/MODULE_GUIDE.md](./docs/MODULE_GUIDE.md) — follow it literally, including the DoD checklist |
| Touch the database, a schema, or a migration | [docs/DATA_MODEL.md](./docs/DATA_MODEL.md) |
| Implement a rule, validation, or state transition | [docs/BUSINESS_RULES.md](./docs/BUSINESS_RULES.md) |
| Name something, structure a file, or handle an error | [docs/CODING_STANDARDS.md](./docs/CODING_STANDARDS.md) |
| Write or run tests | [docs/TESTING.md](./docs/TESTING.md) |

If two documents appear to conflict, **stop and ask**. Do not pick one silently.

---

## 3. Non-negotiable design invariants

```
Dependency direction:   modules/*  →  core/  →  (nothing)
                        platform/  →  core/
                        core/      →  never platform/, never modules/

Cross-module contact:   Level 1  events        (default; @modubiz/contracts/events)
                        Level 2  read port     (declared; requires justification)
                        Level 3  command port  (same transaction; requires strong justification)
                        Anything else: forbidden

Tenancy:                organization_id from session → TenantContext → SET LOCAL → RLS
                        No tenant context ⇒ zero rows (fail closed)

Money:                  bigint minor units + char(3) currency; FX rate snapshotted on write
Ledgers:                append-only; corrections are new rows
Events:                 published after commit; handlers idempotent
Authorization:          @RequiresModule (entitlement) then @RequiresPermission (RBAC)
```

---

## 4. Layer responsibilities (memorize)

| Layer | Does | Must not |
|---|---|---|
| `api/` | HTTP routing, DTO validation, response mapping, guards | Business logic, database access |
| `application/` | One use case per operation; owns the transaction; orchestrates domain + repositories; collects events | Import Drizzle or HTTP types |
| `domain/` | Entities, value objects, invariants, domain errors — pure TypeScript | Import anything with I/O |
| `infrastructure/` | Drizzle repositories, external adapters | Be imported by `domain/` |
| `events/handlers/` | Validate the payload, delegate to a use case, stay idempotent | Contain business logic inline |

If deleting `api/` and `infrastructure/` would break your business rules, they are in the wrong layer.

---

## 5. Standard shape of a change

1. **Understand before editing.** Read the relevant docs and the surrounding code. Never propose changes to a file you have not read.
2. **Contracts first.** New event, permission, module key, or port → declare it in `packages/contracts` before implementing.
3. **Domain first.** Encode the invariant in `domain/` with a unit test, then build outward.
4. **One transaction per use case.** Publish events after commit.
5. **Audit mutations.** Every create/update/delete records an audit entry.
6. **Test the rule, cite the rule.** Test names carry the rule id: `it('INV-6: rejects an online sale exceeding available stock')`.
7. **Verify before declaring done.** `pnpm lint && pnpm typecheck && pnpm test`. For database or module changes, also run the integration and isolation suites.
8. **Update the docs in the same change** when behaviour, rules, or structure change.

---

## 6. Commands

| Command | Purpose |
|---|---|
| `pnpm install` | Install the workspace |
| `pnpm docker:up` | Start Postgres + Redis |
| `pnpm db:migrate` / `pnpm db:seed` | Migrate / seed |
| `pnpm dev` | Run API + web |
| `pnpm lint` / `pnpm typecheck` | Static checks |
| `pnpm test` | Unit tests |
| `pnpm test:integration` | Integration + isolation tests (needs Docker) |
| `pnpm test:arch` | Architecture boundary tests |
| `pnpm test:e2e` | Playwright |
| `pnpm generate:module <key>` | Scaffold a new module — always use this, never copy an existing module |
| `pnpm generate:api-client` | Regenerate the typed client from OpenAPI |

Commit format: Conventional Commits with a module scope — `feat(inventory): add stock reservation expiry job`.

---

## 7. Quick reference: forbidden → correct

| ❌ | ✅ |
|---|---|
| `import { X } from '@/modules/other/...'` | Event or declared port |
| `.where(eq(t.organizationId, orgId))` in feature code | Rely on RLS via `TransactionManager` |
| `organizationId` taken from the request body | Derive it from the session |
| `price: number`, `toFixed(2)` | `Money` from `@modubiz/money` |
| `"Save changes"` in JSX | `t('common.save')` |
| `ml-4`, `text-left` | `ms-4`, `text-start` |
| `if (user.role === 'ADMIN')` | `@RequiresPermission(...)` |
| `throw new Error('not enough stock')` | `throw new InsufficientStockError({ sku, available })` |
| `console.log(...)` | Injected logger with structured fields |
| `catch {}` | Handle, wrap with context, or rethrow |
| `process.env.DATABASE_URL` | Typed config service |
| FK from `pos_sales` to `crm_contacts` | Store the id, validate through a port |
| Editing `0003_add_column.sql` after merge | New forward migration |
| `UPDATE inv_stock_movements ...` | Append a compensating movement |
| Adding a field to `core/` for one module | Keep it in the module |
| Hardcoded subscription price | `stripePriceKey` resolved from Stripe |

---

## 8. When to stop and ask

Ask instead of guessing when:

- A requirement is ambiguous, or two documents conflict.
- The clean solution appears to require a cross-module import — that means the boundary or the design is wrong.
- You need to change anything in `apps/api/src/core/` in order to add a module (adding a module must not require it).
- You need a new runtime dependency not listed in [docs/TECH_STACK.md](./docs/TECH_STACK.md).
- A business rule seems wrong or incomplete.
- A change would break an existing event contract or API response shape.
- A migration would be destructive or irreversible.
- Anything touches authentication, RLS policies, billing, or money arithmetic — these are the highest-risk areas in the system.

A short question is always cheaper than a boundary violation that has to be unwound later.

---

## 9. Definition of done

A change is complete only when all of the following hold:

- [ ] Lint, format, and typecheck pass.
- [ ] Unit tests cover every new or changed domain invariant, with rule ids in the test names.
- [ ] Integration tests cover new use cases against real Postgres with RLS active.
- [ ] Tenant-isolation tests exist and pass for any new module or new tenant table.
- [ ] Architecture boundary tests pass (no cross-module imports, no FK across prefixes, RLS on every tenant table).
- [ ] Every new tenant table has the standard RLS policy and the mandatory base columns.
- [ ] All user-facing text is an i18n key, present in `en`, `ar`, `fr`, and `es`.
- [ ] All monetary values use `Money`; new money columns are `bigint` + currency.
- [ ] Mutating operations write audit entries.
- [ ] OpenAPI and `@modubiz/api-client` regenerated if routes changed.
- [ ] Affected documentation updated in the same change.
- [ ] No `TODO` without an issue reference, no commented-out code, no `console.log`.

---

## 10. Document map

| File | Contents |
|---|---|
| [README.md](./README.md) | Project overview, repo map, quickstart |
| [docs/PRD.md](./docs/PRD.md) | Product requirements, scope, module lifecycle, metrics |
| [docs/TECH_STACK.md](./docs/TECH_STACK.md) | Locked technology choices, rejected alternatives, env vars |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Structure, layering, boundaries, request lifecycle, extraction path |
| [docs/MODULE_GUIDE.md](./docs/MODULE_GUIDE.md) | How to add a module + Definition of Done checklist |
| [docs/DATA_MODEL.md](./docs/DATA_MODEL.md) | Tenancy, RLS, conventions, money, MVP schemas, migrations |
| [docs/BUSINESS_RULES.md](./docs/BUSINESS_RULES.md) | Enforceable invariants with stable rule ids |
| [docs/CODING_STANDARDS.md](./docs/CODING_STANDARDS.md) | Conventions, error model, forbidden patterns |
| [docs/TESTING.md](./docs/TESTING.md) | Test strategy, mandatory suites, CI gates |
