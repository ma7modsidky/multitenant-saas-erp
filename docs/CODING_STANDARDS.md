# ModuBiz — Coding Standards

**Status:** Locked. Version 1.0. Everything here is enforced by ESLint,
TypeScript, or review. If a rule cannot be automated, it is still binding.

---

## 1. TypeScript

```jsonc
// packages/tsconfig/base.json (non-negotiable flags)
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true,
  "exactOptionalPropertyTypes": true,
  "verbatimModuleSyntax": true,
  "isolatedModules": true,
}
```

| Rule                               | Detail                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| No `any`                           | Use `unknown` and narrow. An unavoidable `any` requires `// eslint-disable-next-line` **with a reason on the same line**. |
| No non-null `!`                    | Narrow explicitly, or throw a typed error.                                                                                |
| No unsafe casts                    | `as` is allowed only for branded types and after a Zod parse. Never `as unknown as X`.                                    |
| Prefer `type` for shapes           | `interface` only for extensible contracts and DI ports.                                                                   |
| Discriminated unions over booleans | `{ status: 'open' } \| { status: 'closed'; closedAt: Date }` beats `isClosed`.                                            |
| Branded ids                        | `type OrganizationId = string & { readonly __brand: 'OrganizationId' }` for ids that must not be interchangeable.         |
| Exhaustiveness                     | `switch` on unions ends with a `never`-asserting default.                                                                 |
| `readonly` by default              | Domain properties and arrays are `readonly` unless mutation is intended.                                                  |
| No default exports                 | Named exports only (except Next.js pages/layouts, where the framework requires them).                                     |
| No barrel re-export chains         | Only `public/index.ts` and package roots are barrels.                                                                     |

---

## 2. Naming

| Element             | Convention                                           | Example                                                                          |
| ------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| File                | `kebab-case` with a role suffix                      | `adjust-stock.use-case.ts`, `products.controller.ts`, `stock-movement.entity.ts` |
| Class               | `PascalCase`                                         | `AdjustStockUseCase`                                                             |
| Interface / port    | `PascalCase`, no `I` prefix except contract ports    | `StockRepository`, `InventoryStockPort`                                          |
| DI token            | `SCREAMING_SNAKE` symbol                             | `INVENTORY_STOCK_PORT`                                                           |
| Function / variable | `camelCase`                                          | `calculateLineTotal`                                                             |
| Constant            | `SCREAMING_SNAKE`                                    | `MAX_PAGE_SIZE`                                                                  |
| Zod schema          | `<name>Schema`                                       | `createProductSchema`                                                            |
| Type from schema    | `PascalCase`                                         | `type CreateProduct = z.infer<typeof createProductSchema>`                       |
| Event name          | `<module>.<aggregate>.<pastTense>.v<n>`              | `inventory.stock.depleted.v1`                                                    |
| Permission key      | `<module>:<resource>:<action>`                       | `inventory:stock:adjust`                                                         |
| Error code          | `SCREAMING_SNAKE`, module-prefixed for domain errors | `INV_INSUFFICIENT_STOCK`                                                         |
| i18n key            | dot path, `modules.<key>.` for module copy           | `modules.inventory.nav.products`                                                 |
| Boolean             | `is` / `has` / `can` prefix                          | `isActive`, `canRefund`                                                          |
| Use case method     | always `execute`                                     | `execute(input): Promise<Output>`                                                |
| React component     | `PascalCase` in `PascalCase.tsx`                     | `StockLevelBadge.tsx`                                                            |
| React hook          | `use` prefix                                         | `useStockLevels`                                                                 |

**Anti-names:** `data`, `info`, `helper`, `utils` (as a class), `manager`
(unless it manages a resource lifecycle), `handleStuff`, `temp`, `obj`.

---

## 3. File and function size

| Limit                 | Value     | Action if exceeded              |
| --------------------- | --------- | ------------------------------- |
| File                  | 300 lines | Split by responsibility         |
| Function              | 50 lines  | Extract named steps             |
| Cyclomatic complexity | 10        | Decompose or use a strategy map |
| Function parameters   | 3         | Take a single named object      |
| Nesting depth         | 3         | Early returns and guard clauses |
| Controller method     | 15 lines  | Move logic to the use case      |

These are lint warnings at the threshold and review blockers well past it. They
are heuristics for "this does too much", not targets to game.

---

## 4. Module and layer discipline

Restated here because it is the most-violated rule in the codebase:

```typescript
// ✅ Legal
import { TransactionManager } from '@/core/database';
import { EVENTS, type StockDepletedV1 } from '@modubiz/contracts';
import { INVENTORY_STOCK_PORT } from '@modubiz/contracts/ports';

// ❌ Illegal — ESLint error + architecture test failure
import { InventoryService } from '@/modules/inventory/application/inventory.service';
import { invProducts } from '@/modules/inventory/db/schema';
import { OrganizationsService } from '@/platform/organizations'; // from a module
```

| Layer                | Never imports                                                                     |
| -------------------- | --------------------------------------------------------------------------------- |
| `domain/`            | Nest, Drizzle, HTTP, Fastify, Redis, Stripe, `core/` services — anything with I/O |
| `application/`       | Drizzle, Fastify/HTTP types, another module                                       |
| `api/`               | Drizzle, repositories                                                             |
| `core/`              | anything from `platform/` or `modules/`                                           |
| `packages/contracts` | Nest, Drizzle, React                                                              |

The `domain/` restriction is the important one: if a domain file imports a
framework, the module is no longer independently testable or extractable.

---

## 5. Validation

| Rule                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every external input is parsed with Zod at the boundary: HTTP bodies/params/queries, event payloads, environment variables, third-party API responses, webhook bodies. |
| Request schemas live in `api/dto/`; shared schemas live in `@modubiz/contracts` so the frontend reuses them for forms.                                                 |
| Domain constructors re-validate their own invariants. Never assume the DTO already checked a business rule — jobs and event handlers bypass controllers.               |
| Never trust `organizationId`, `userId`, price, or role values from the client. Derive them server-side.                                                                |
| Unknown properties are stripped, not passed through (`.strict()` on write schemas).                                                                                    |
| Pagination inputs are clamped server-side (`limit` max 100).                                                                                                           |

```typescript
export const createProductSchema = z
  .object({
    nameI18n: z
      .record(z.string().min(1))
      .refine((v) => Object.keys(v).length > 0, 'AT_LEAST_ONE_LOCALE'),
    categoryId: z.string().uuid().optional(),
    price: moneySchema, // { amountMinor: string, currency: CurrencyCode }
    reorderPoint: z.number().nonnegative().optional(),
  })
  .strict();
```

---

## 6. Dependency injection

| Rule                                                                                                         |
| ------------------------------------------------------------------------------------------------------------ |
| Constructor injection only. No service locator, no `moduleRef.get()` in business code.                       |
| Depend on interfaces (repositories, ports), not concrete classes, wherever it enables testing or extraction. |
| Register cross-module ports by symbol token, never by class.                                                 |
| No circular dependencies. `forwardRef()` is a design smell — if you need it, the boundary is wrong.          |
| Services are stateless. Per-request state belongs in `TenantContext` (AsyncLocalStorage).                    |
| A constructor with more than 5 dependencies signals a use case doing too much.                               |

---

## 7. Error model

### Hierarchy

```typescript
// core/common/errors
export abstract class AppError extends Error {
  abstract readonly code: string; // stable, machine-readable
  abstract readonly httpStatus: number;
  readonly params?: Record<string, unknown>; // for client-side message interpolation
}

export class DomainError extends AppError {} // 422 — invariant violated
export class NotFoundError extends AppError {} // 404
export class ConflictError extends AppError {} // 409 — idempotency, version, duplicate
export class ForbiddenError extends AppError {} // 403
export class ValidationError extends AppError {} // 400
```

### Wire format

```jsonc
// Error
{
  "error": {
    "code": "INV_INSUFFICIENT_STOCK",
    "params": { "sku": "ESP-250", "available": "3", "requested": "5" },
    "correlationId": "01J9X3T2K7QW",
    "details": [{ "path": "lines.0.quantity", "code": "TOO_LARGE" }]
  }
}

// Success
{ "data": { }, "meta": { "cursor": "…", "hasMore": true } }
```

### Rules

| ID    | Rule                                                                                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ERR-1 | The API never returns a user-facing sentence. `code` + `params` only; the client renders localized copy.                                             |
| ERR-2 | Error codes are stable public contract. Renaming one is a breaking API change.                                                                       |
| ERR-3 | Never throw a bare `Error` or a string in application code.                                                                                          |
| ERR-4 | Never swallow an error. Handle it, wrap it with context, or let it propagate — `catch {}` is forbidden.                                              |
| ERR-5 | Never leak internal details (SQL, stack traces, driver messages, upstream response bodies) to clients. Log them; return a code.                      |
| ERR-6 | Unexpected errors become `500 INTERNAL_ERROR` with the correlation id, and are reported to Sentry.                                                   |
| ERR-7 | Every domain error code appears in the i18n catalogs for all supported locales. CI fails on an unmapped code.                                        |
| ERR-8 | Expected business outcomes that are not failures (e.g. "no stock to reserve") are return values, not exceptions. Exceptions are for rule violations. |

---

## 8. Logging and observability

| Rule                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- |
| `console.log` / `console.error` are lint errors. Use the injected Pino logger.                                                    |
| Every log line automatically carries `correlationId`, `organizationId`, `userId`, and `module`.                                   |
| Structured fields only — never string-interpolate values into the message: `logger.info({ saleId }, 'sale completed')`.           |
| Never log secrets, tokens, password hashes, full card data, or complete request bodies. Use the redaction allowlist.              |
| Levels: `error` = needs a human; `warn` = degraded/recovered; `info` = business-significant events; `debug` = development detail. |
| Log at boundaries (request, job, external call, event handling), not inside every function.                                       |
| Business metrics (sales completed, trials started, modules enabled) are emitted as counters, not inferred from logs.              |
| Every external call is a traced span with the target, duration, and outcome.                                                      |

---

## 9. Asynchronous code

| Rule                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------- |
| `async`/`await` only. No raw `.then()` chains, no callbacks.                                                                          |
| Every promise is awaited or explicitly handed to a fire-and-forget helper that logs its rejection. Floating promises are lint errors. |
| Parallelize independent work with `Promise.all`; use `Promise.allSettled` when partial failure is acceptable.                         |
| Never `await` inside a loop over unbounded input — batch it.                                                                          |
| Never hold a database transaction open across an external HTTP call.                                                                  |
| Every external call has an explicit timeout.                                                                                          |
| Retries use exponential backoff with jitter and a bounded attempt count, and only for idempotent operations.                          |

---

## 10. Frontend specifics

| Rule                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server Components by default; `'use client'` only where interactivity requires it.                                                                                                                       |
| All server data flows through TanStack Query hooks wrapping `@modubiz/api-client`. No direct `fetch` to the API.                                                                                         |
| No user-facing string literals in JSX — `useTranslations()` / `getTranslations()` only.                                                                                                                  |
| RTL: logical Tailwind utilities only (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`, `text-end`). `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right` are lint errors. |
| Money renders only via `<Money value={…} />` or `formatMoney()`. `toFixed` on a money value is forbidden.                                                                                                |
| Dates render only via the shared formatters, in the organization's timezone.                                                                                                                             |
| Forms use `react-hook-form` + the shared Zod schema. No hand-rolled validation.                                                                                                                          |
| Every mutating control is wrapped in `<Can permission="…">`; every module surface in `<ModuleGate module="…">`.                                                                                          |
| Loading, empty, and error states are required for every data view. A bare spinner with no error path fails review.                                                                                       |
| `features/a` must not import from `features/b`. Shared UI belongs in `@modubiz/ui`.                                                                                                                      |
| Accessibility: semantic elements, labelled inputs, visible focus, keyboard operability. The POS must be fully keyboard- and scanner-driven.                                                              |
| No `useEffect` for data fetching. No derived state in `useState` where a computed value works.                                                                                                           |

---

## 11. Security requirements

| Rule                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------- |
| Never construct SQL by string concatenation. Use Drizzle's builder or parameterized `sql` templates.                   |
| Never disable RLS, never connect as a table owner from the application, never add `BYPASSRLS` to the app role.         |
| Never read `process.env` outside `packages/config`.                                                                    |
| Secrets never appear in source, tests, fixtures, logs, error messages, or commit history.                              |
| All authorization decisions are server-side. Client gating is UX.                                                      |
| File uploads: presigned direct-to-storage, with content-type and size validation, and keys namespaced by organization. |
| Webhooks verify signatures before parsing the body.                                                                    |
| Rate limits on all authentication, invitation, export, and sync endpoints.                                             |
| CORS is an explicit allowlist. Cookies are `httpOnly`, `secure`, `sameSite=lax`.                                       |
| Dependencies are scanned in CI; a critical advisory blocks merge.                                                      |
| Any user-supplied HTML is sanitized. `dangerouslySetInnerHTML` requires a review note.                                 |

---

## 12. Comments and documentation

| Rule                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- |
| Comments explain **why**, never **what**. Code that needs a "what" comment should be renamed or extracted.          |
| Business rules referenced in code cite their id: `// INV-6: negative stock only via documented override`.           |
| Public services, use cases, and contracts get a short TSDoc block describing purpose, throws, and events published. |
| No commented-out code. Delete it; git remembers.                                                                    |
| No `TODO` without an issue reference: `// TODO(#412): …`.                                                           |
| A rule change requires updating the owning document in the same PR. Documentation drift is a defect.                |

---

## 13. Git and pull requests

### Commits — Conventional Commits, enforced by commitlint

```
feat(inventory): add stock reservation expiry job
fix(pos): prevent duplicate receipt numbers on offline sync
refactor(crm): extract deal stage transition into domain entity
docs(architecture): clarify level-3 port justification
test(inventory): add tenant isolation coverage for stock levels
chore(deps): bump drizzle-orm to 0.36
```

Types: `feat` · `fix` · `refactor` · `perf` · `test` · `docs` · `chore` ·
`build` · `ci`. Scope is the module or package name. Subject is imperative,
lowercase, no trailing period.

### Branches

`feat/<module>-<short-description>` · `fix/<module>-<short-description>` ·
`chore/<description>`

### Pull requests

- One logical change. A PR that both refactors and adds a feature will be asked
  to split.
- Description states **what**, **why**, and **how it was verified**.
- Business-rule changes link the rule ids affected.
- New module PRs include the full
  [MODULE_GUIDE.md §5](./MODULE_GUIDE.md#5-definition-of-done-checklist)
  checklist.
- Migrations state their rollback plan.
- No merge while any CI gate is red. No force-push to `main`.

---

## 14. Forbidden patterns — quick reference

| ❌ Never                                             | ✅ Instead                               |
| ---------------------------------------------------- | ---------------------------------------- |
| `import ... from '@/modules/other-module/...'`       | Event or declared port                   |
| `where(eq(t.organizationId, orgId))` in feature code | Rely on RLS via `TransactionManager`     |
| `float`/`number` for money, `toFixed(2)`             | `@modubiz/money`                         |
| `new Date().toLocaleString()` ad hoc                 | Shared formatters with org timezone      |
| Hardcoded user-facing string                         | i18n key                                 |
| `ml-4`, `text-left`                                  | `ms-4`, `text-start`                     |
| `if (user.role === 'ADMIN')`                         | `@RequiresPermission(...)` / CASL        |
| `process.env.X` outside `packages/config`            | Typed config service                     |
| `console.log`                                        | Injected logger                          |
| `catch {}` or `catch (e) { /* ignore */ }`           | Handle, wrap, or rethrow                 |
| `throw new Error('...')` in app code                 | Typed `AppError` subclass with a code    |
| Business logic in a controller                       | Use case                                 |
| Database access outside a transaction                | `TransactionManager.run()`               |
| Publishing an event inside a transaction             | Publish after commit (or use the outbox) |
| `as unknown as T`                                    | Zod parse and narrow                     |
| FK across module prefixes                            | Id reference + port validation           |
| Editing a merged migration                           | New forward migration                    |
| `UPDATE`/`DELETE` on a ledger table                  | Compensating append                      |
| Direct `fetch` from the frontend to the API          | Generated client + TanStack Query        |
| Hardcoded price amounts                              | `stripePriceKey` resolved at runtime     |

---

## 15. Automated enforcement

| Check                                          | Tool                                                  | Gate                  |
| ---------------------------------------------- | ----------------------------------------------------- | --------------------- |
| Formatting                                     | Prettier                                              | pre-commit + CI       |
| Lint incl. boundary rules                      | ESLint flat config with `no-restricted-imports` zones | CI blocking           |
| Types                                          | `tsc --noEmit` across the workspace                   | CI blocking           |
| Architecture boundaries                        | dependency-cruiser + architecture tests               | CI blocking           |
| Commit messages                                | commitlint                                            | pre-commit            |
| RLS coverage (every tenant table has a policy) | custom script over the schema                         | CI blocking           |
| i18n key completeness + unmapped error codes   | custom script                                         | CI blocking           |
| Forbidden directional CSS utilities            | ESLint Tailwind rule                                  | CI blocking           |
| Coverage thresholds                            | Vitest                                                | CI blocking           |
| Dependency advisories                          | `pnpm audit` + Dependabot                             | critical blocks merge |
| Secret scanning                                | gitleaks                                              | CI blocking           |
| OpenAPI/client drift                           | generate + `git diff --exit-code`                     | CI blocking           |

---

## 16. Related documents

[PRD.md](./PRD.md) · [TECH_STACK.md](./TECH_STACK.md) ·
[ARCHITECTURE.md](./ARCHITECTURE.md) · [MODULE_GUIDE.md](./MODULE_GUIDE.md) ·
[DATA_MODEL.md](./DATA_MODEL.md) · [BUSINESS_RULES.md](./BUSINESS_RULES.md) ·
[TESTING.md](./TESTING.md)
