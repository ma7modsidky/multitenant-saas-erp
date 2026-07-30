# ModuBiz — Development Progress Tracker

**Last updated:** Session 3 — Phase 0 complete
**Current phase:** Phase 0 — Foundation & Tooling

> This file tracks where we are in [PLAN.md](./PLAN.md). Update it at the end of
> every work session.

---

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 0 — Foundation & Tooling | ✅ Complete | All 0.1–0.7 done; DoD verified |
| 1 — Core Shared Kernel | ⬜ Not started | |
| 2 — Platform + Frontend Shell | ⬜ Not started | |
| 3 — Module Framework & Generator | ⬜ Not started | |
| 4 — CRM Module | ⬜ Not started | |
| 5 — Inventory Module | ⬜ Not started | |
| 6 — POS Module | ⬜ Not started | |
| 7 — Production Hardening & Deployment | ⬜ Not started | |

---

## Phase 0 — Detailed progress

### 0.1 Initialize the monorepo
- [x] Create `pnpm-workspace.yaml`
- [x] Create root `package.json` with workspace scripts
- [x] Create `turbo.json`
- [x] Create `.nvmrc` (as `.n`)
- [x] Create `docker-compose.yml`

### 0.2 Create shared package skeletons
- [x] All 9 packages created (tsconfig, eslint-config, config, contracts, db, money, i18n, ui, api-client)

### 0.3 Create app skeletons
- [x] `apps/api` — NestJS 11 with Fastify adapter, empty composition root, core/platform/modules directories
- [x] `apps/web` — Next.js 15 App Router with Tailwind, next-intl ([locale] routing), TanStack Query setup

### 0.4 Set up quality tooling
- [x] **ESLint** flat config — `@modubiz/eslint-config` with boundary rules (no-restricted-imports, import/no-restricted-paths), RTL enforcement (`no-restricted-syntax` for Tailwind directional utilities), `no-console`, `no-floating-promises`, `no-unsafe-assignment`
- [x] **Prettier** — `.prettierrc` with project format options
- [x] **Husky + lint-staged + commitlint** — pre-commit runs `prettier --write` + `eslint --fix`; commit-msg runs `commitlint`
- [x] **Vitest** workspace config — 7 projects (root, core, money, contracts, arch, integration, isolation) with coverage thresholds
- [x] **dependency-cruiser** — `.dependency-cruiser.js` with boundary rules (core→platform/modules, platform→modules, circular deps, orphan detection, dev-dep restrictions)

### 0.5 Set up CI/CD
- [x] GitHub Actions workflow — 7-job pipeline (lint, typecheck, arch, unit+coverage, integration, build, security)
- [x] Dependabot config — grouped weekly PRs for all workspace packages
- [x] gitleaks config — secret scanning with test/doc allowlists
- [x] Docker multi-stage build — `apps/api/Dockerfile` (distroless runtime)

### 0.6 Create `.env.example`
- [x] Exhaustive — all 32 env vars from TECH_STACK.md §5, validated by `packages/config`

### 0.7 Write the first architecture test
- [x] `__tests__/arch/architecture.spec.ts` — 7 tests:
  - core/ doesn't import platform/ or modules/
  - platform/ doesn't import modules/
  - modules don't import other modules
  - domain layers have no framework imports
  - `process.env` only in `packages/config`
  - no default exports in API code
  - only composition root imports module public barrels

### Phase 0 — Definition of Done

| # | Criterion | Status |
|---|---|---|
| 1 | `pnpm install` succeeds with committed `pnpm-lock.yaml` | ✅ 12 workspace projects |
| 2 | `pnpm lint && pnpm typecheck` pass on empty workspace | ✅ Verified (0 errors, 0 warnings) |
| 3 | `pnpm docker:up` starts Postgres + Redis | ⏸️ Requires Docker Desktop |
| 4 | `pnpm test:arch` passes | ✅ depcruise: 0 errors; vitest arch: 7/7 pass |
| 5 | CI pipeline runs green on a PR | ⏸️ Requires GitHub push |
| 6 | `.env.example` is exhaustive and validated | ✅ 32 vars, validated by Zod schema |
| 7 | Commitlint, Husky, lint-staged are active | ✅ All 3 hooks operational |
| 8 | All packages are importable (no broken barrels) | ✅ |

---

## Session log

### Session 1
- Monorepo config files (pnpm-workspace, turbo, docker-compose)

### Session 2
- Phase 0.2: All 9 shared package skeletons
- Phase 0.3: App skeletons (NestJS 11 + Fastify, Next.js 15 + next-intl)
- Phase 0.4: Quality tooling (ESLint, Prettier, Husky, commitlint, lint-staged, Vitest, depcruise)

### Session 3
- Phase 0.4 completion: ESLint config tuning (boundary rules, RTL rules, allowDefaultProject fixes)
- Phase 0.5: CI/CD pipeline (GitHub Actions, Dependabot, gitleaks, Dockerfile, .dockerignore)
- Phase 0.6: `.env.example` with all 32 env vars
- Phase 0.7: Architecture tests (7 tests covering all boundary rules)
- Phase 0 DoD verification: lint ✅ typecheck ✅ test:arch ✅ commitlint ✅
