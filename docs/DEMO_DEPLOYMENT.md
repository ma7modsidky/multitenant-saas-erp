# ModuBiz — Free Demo Deployment Guide

Deploy a live, shareable demo of ModuBiz **before** Phase 7 (Production
Hardening), using only free-tier services. Total cost: **$0**. Total time:
**~45–60 minutes**.

> This is a **demo**, not a production deployment. It uses the placeholder
> adapters (fake Stripe, in-memory cache/jobs, no real email). See
> [§12 Security notes](#12-before-you-go-public--security-notes) before sharing
> the URL widely.

---

## 1. What you're deploying

```
Browser
   │
   ▼
Vercel (apps/web)          Next.js 15 app — UI, PWA shell, service worker
   │  HTTPS + Bearer token
   ▼
Render (apps/api)          NestJS + Fastify API — `node dist/main`
   │  RLS-enforced Postgres
   ▼
Neon                       Serverless Postgres — `modubiz_app` (app) + owner (migrations)
```

| Piece    | Where                         | What runs                                              |
| -------- | ----------------------------- | ------------------------------------------------------ |
| Web app  | **Vercel** (free Hobby)       | `apps/web` — Next.js build                             |
| REST API | **Render** (free web service) | `apps/api` — NestJS/Fastify, long-running Node process |
| Database | **Neon** (free tier)          | Postgres with RLS, migrations + seed                   |

The repo is a pnpm monorepo with Turbo. Both hosts build the workspace packages
(`@modubiz/*`) before building the app — the same order the repo's own CI uses
(`pnpm build` in `.github/workflows/ci.yml`).

## 2. Why you DON'T need Redis, Stripe, or email for the demo

This is the part that makes a free demo easy — the backend is currently wired to
**placeholder adapters** for everything except Postgres:

| Service               | Production plan           | Current state in this codebase                                     | Needed for demo?                                                        |
| --------------------- | ------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Redis**             | ioredis + BullMQ          | In-memory cache + in-memory job queue (`core/cache`, `core/jobs`)  | ❌ Just set `REDIS_URL` to any non-empty string; it is only _validated_ |
| **Stripe**            | Real billing              | `FakeStripeAdapter`                                                | ❌ Any non-empty `STRIPE_SECRET_KEY`                                    |
| **Email (Resend)**    | Verification/reset emails | Placeholder sender; signup does **not** require email verification | ❌ Any non-empty `RESEND_API_KEY` + any valid-looking `EMAIL_FROM`      |
| **File storage (R2)** | Uploads                   | Placeholder adapter                                                | ❌ Any non-empty `R2_*` values                                          |
| **FX rates**          | Live provider             | Mock rates seeded by `pnpm db:seed`                                | ❌ Use the default provider URL; seed covers the demo                   |
| **Postgres**          | RLS multi-tenant          | **Real**                                                           | ✅ **This is the only real dependency**                                 |

So the whole backend runs on **one free Postgres database**. No Redis instance
to provision, no webhooks, no email provider.

## 3. Free-tier limits (the honest fine print)

| Service                 | Free allowance                       | Gotcha                                                                                       |
| ----------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| Vercel Hobby            | 100 GB bandwidth/mo, serverless      | None for a demo                                                                              |
| Render free web service | 512 MB RAM, 750 hrs/mo               | **Spins down after 15 min idle** — first load after idle takes ~30–60 s (see §10 keep-alive) |
| Neon free               | 0.5 GB storage, 100 compute-hours/mo | **Compute scales to zero after 5 min idle**; wakes automatically on connect                  |

Both "sleep" behaviors are fine for a demo — the API wakes on the first request
and Neon wakes when the API connects.

## 4. Prerequisites

- The repo pushed to **GitHub** (already done — `main` is on GitHub).
- Free accounts: **GitHub** (have it), **Vercel** (vercel.com — "Continue with
  GitHub"), **Render** (render.com — "Continue with GitHub"), **Neon**
  (neon.tech — same).
- Locally: **Node.js ≥ 22** and **pnpm ≥ 9** (the repo pins `pnpm@11.17.0`;
  `corepack enable` if your shell can't find pnpm).
- The repo cloned locally
  (`git clone https://github.com/<you>/modular_erp_2.git`).

---

## 5. Step 1 — Database: Neon

### 5.1 Create the project

1. Sign in at [neon.tech](https://neon.tech) with GitHub.
2. **New project** → name it `modubiz-demo`, region nearest to you, pick the
   **Free** plan. It creates one database (`neondb`) and one compute.

### 5.2 Create the app role (required!)

The app must connect as `modubiz_app` (a non-owner role) so **Row-Level Security
is actually enforced**. The migrations `GRANT ... TO modubiz_app`, so this role
**must exist before you run migrations**.

1. In the Neon dashboard, open **SQL Editor**.
2. Paste and run (change the password to something you choose):

```sql
-- Mirror of docker/postgres/init/init.sql — the app role, RLS enforced (NOBYPASSRLS)
CREATE ROLE modubiz_app LOGIN PASSWORD 'change-me-strong-password' NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO modubiz_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO modubiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO modubiz_app;

-- Future tables created by the owner role are auto-granted too
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO modubiz_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO modubiz_app;
```

> Do **not** create `modubiz_app` as a Neon Console role with `neon_superuser`
> membership — that could silently bypass RLS. The plain `CREATE ROLE` above is
> the correct, safe path.

### 5.3 Copy the two connection strings

In Neon: **Dashboard → your project → Connect** → pick **Password** auth → copy
the connection string. It looks like:

```
postgresql://neondb_owner:ABc123...@ep-xxxx.us-east-2.aws.neon.tech/neondb
```

You need **two** URLs:

| Purpose                               | User                            | How to build                                                                      |
| ------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL` (app runtime)          | `modubiz_app`                   | Replace `neondb_owner` with `modubiz_app` and the password with the one from §5.2 |
| `DATABASE_MIGRATION_URL` (migrations) | the Neon owner (`neondb_owner`) | As-is from the dashboard                                                          |

Append `?sslmode=require` to both:

```
postgres://modubiz_app:change-me-strong-password@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
postgres://neondb_owner:ABc123...@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

Keep these two URLs — you'll paste them into Render (§6) and use them locally
(§7).

---

## 6. Step 2 — API: Render

### 6.1 Create the web service

1. [render.com](https://render.com) → **New +** → **Web Service** → connect your
   GitHub repo → pick it → **Create Web Service** (don't use the "Blueprint"
   flow).
2. Before the first deploy, set these fields:

| Setting             | Value                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Name                | `modubiz-api`                                                                                   |
| Branch              | `main`                                                                                          |
| **Root Directory**  | `apps/api`                                                                                      |
| Environment         | `Node` (Node 22)                                                                                |
| **Install Command** | `corepack enable && corepack prepare pnpm@11.17.0 --activate && pnpm install --frozen-lockfile` |
| **Build Command**   | `pnpm --filter "@modubiz/*" build && pnpm build`                                                |
| **Start Command**   | `node dist/main`                                                                                |
| Health Check Path   | _(leave blank — this build has no public `/health` route)_                                      |

> **Why these commands?** The API imports workspace packages (`@modubiz/config`,
> `@modubiz/db`, …) whose `dist/` output is git-ignored. The build command
> compiles all `@modubiz/*` packages first, then runs `nest build` (the app's
> own `build` script). `node dist/main` is the same start command used locally.
> The repo's own CI uses this exact order.

### 6.2 Environment variables

Open **Environment** on the service and add **every** row (the app validates all
of them at boot and **refuses to start** if one is missing):

| Key                      | Value                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | `production`                                                                                                            |
| `API_BASE_URL`           | `https://modubiz-api.onrender.com` (the service URL)                                                                    |
| `WEB_BASE_URL`           | `https://<your-app>.vercel.app` — **must match the Vercel URL exactly, no trailing slash** (this is the CORS allowlist) |
| `DATABASE_URL`           | the `modubiz_app` URL from §5.3                                                                                         |
| `DATABASE_MIGRATION_URL` | the owner URL from §5.3 (needed even at runtime — it is validated)                                                      |
| `DATABASE_POOL_MAX`      | `10`                                                                                                                    |
| `REDIS_URL`              | `redis://localhost:6379` _(validated only — cache is in-memory)_                                                        |
| `JWT_ACCESS_SECRET`      | random ≥32 chars — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`                           |
| `JWT_REFRESH_SECRET`     | a **different** random ≥32 chars                                                                                        |
| `JWT_ACCESS_TTL`         | `15m`                                                                                                                   |
| `JWT_REFRESH_TTL`        | `30d`                                                                                                                   |
| `STRIPE_SECRET_KEY`      | `sk_test_demo` _(FakeStripeAdapter)_                                                                                    |
| `STRIPE_WEBHOOK_SECRET`  | `whsec_demo`                                                                                                            |
| `RESEND_API_KEY`         | `re_demo` _(placeholder)_                                                                                               |
| `EMAIL_FROM`             | `demo@example.com` (must look like an email)                                                                            |
| `R2_ACCOUNT_ID`          | `demo`                                                                                                                  |
| `R2_ACCESS_KEY_ID`       | `demo`                                                                                                                  |
| `R2_SECRET_ACCESS_KEY`   | `demo`                                                                                                                  |
| `R2_BUCKET`              | `demo`                                                                                                                  |
| `FX_RATES_PROVIDER_URL`  | `https://api.frankfurter.app`                                                                                           |
| `FX_RATES_API_KEY`       | `demo`                                                                                                                  |
| `LOG_LEVEL`              | `info`                                                                                                                  |
| `DEFAULT_LOCALE`         | `en`                                                                                                                    |
| `SUPPORTED_LOCALES`      | `en,ar,fr,es`                                                                                                           |
| `TRIAL_DURATION_DAYS`    | `14`                                                                                                                    |

`PORT` is injected by Render automatically — do **not** set it.

### 6.3 First deploy

Hit **Deploy** and watch the logs. Success looks like:

```
📦 Applying migration: ...
🎉 All migrations applied successfully     ← only if you ran migrations in §7 first
ModuBiz API started {"port":10000}
```

> The deploy itself does **not** run migrations (see §7). It will still boot —
> it just won't have tables until you migrate.

**Check it's alive** (a 401 proves Nest booted and is routing):

```bash
curl -i https://modubiz-api.onrender.com/v1/modules
# HTTP/1.1 401 ...   ← expected, means the server is up
```

---

## 7. Step 3 — Migrate + seed the database (from your machine)

The migration runner connects as the **owner** role and applies
`packages/db/migrations/core` plus every module migration
(`apps/api/src/modules/*/db/migrations`). The seed adds the currency reference
table and mock FX rate pairs that checkout depends on. Both are idempotent and
safe to re-run.

From the repo root, with the Neon URLs from §5.3:

```bash
# 1) Apply all migrations (owner role)
DATABASE_MIGRATION_URL="postgres://neondb_owner:...@ep-....neon.tech/neondb?sslmode=require" pnpm db:migrate

# 2) Seed currencies + FX rates (app role)
DATABASE_URL="postgres://modubiz_app:...@ep-....neon.tech/neondb?sslmode=require" pnpm db:seed
```

You should see `📦 Applying migration: 0001_global_tables.sql` … and end with
`🎉 All migrations applied successfully`, then `✅ Seeded 11 currencies` and
mock FX pairs.

**Verify** in the Neon SQL editor:

```sql
SELECT name FROM _migrations ORDER BY applied_at;        -- the tracking table
SELECT count(*) FROM core_currencies;                    -- 11
SELECT count(*) FROM core_users;                         -- 0 (until someone signs up)
```

> Both commands run `node --env-file=../../.env ...` internally; the inline
> `DATABASE_*` variables take precedence, so you don't need a local `.env`.

---

## 8. Step 4 — Web: Vercel

### 8.1 Import the project

1. [vercel.com](https://vercel.com) → **Add New → Project** → import the GitHub
   repo.
2. Vercel may auto-detect Next.js. Set:

| Setting             | Value                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Framework Preset    | **Next.js**                                                                                     |
| **Root Directory**  | `apps/web`                                                                                      |
| **Install Command** | `corepack enable && corepack prepare pnpm@11.17.0 --activate && pnpm install --frozen-lockfile` |
| **Build Command**   | `pnpm --filter "@modubiz/*" build && pnpm build`                                                |
| Output Directory    | _(leave default)_                                                                               |

> The build command compiles the workspace packages (the web imports
> `@modubiz/i18n` from its `dist/`) and then runs the app's `build` script —
> `node scripts/next-build.cjs`, which wraps `next build` and forces
> `NODE_ENV=production` (avoids a known Next bug). This matches the repo's CI.

### 8.2 Environment variables (build-time)

| Key                        | Value                              |
| -------------------------- | ---------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | `https://modubiz-api.onrender.com` |
| `NEXT_PUBLIC_APP_URL`      | `https://<your-app>.vercel.app`    |

`NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_SENTRY_DSN` are optional — skip them.

### 8.3 Deploy

Click **Deploy**. Vercel gives you `https://<your-app>.vercel.app` (usually
`modubiz-...` or the repo name). The PWA manifest, service worker, and icons
ship as static assets, so the app is also **installable** and its shell works
offline after a first visit — a nice demo talking point.

---

## 9. Step 5 — Verify end-to-end

1. Open `https://<your-app>.vercel.app` (it redirects to `/en`).
2. **Sign up** with any email + password (≥8 chars with a number, e.g.
   `demo@example.com` / `DemoPass123!`). **No email verification is required**
   in this build — you'll be logged in immediately.
3. **Create an organization** (base currency `USD`).
4. Go to the **Module marketplace** and hit **Start free trial** for **CRM**,
   **Inventory**, then **POS** (the UI resolves dependency order for you). The
   trial countdown shows the remaining days of the 14-day trial.
5. **Inventory** → add a product with a variant + stock.
6. **POS** → open a register and a shift → add the product → complete a sale →
   print a receipt.
7. **Reports** → the filtered totals (sales, refunds, net) appear. **Dashboard**
   → Products, Revenue (MTD), and Active Deals now reflect real data.
8. On the **API**: `curl -i https://modubiz-api.onrender.com/v1/modules` still
   401s without a token — that's expected (it's an authenticated catalog).

> **Multi-tenant by default:** every visitor can sign up and get their own org +
> trials. You don't even need to share one login — anyone you send the link to
> can create their own sandbox.

---

## 10. Optional extras

### 10.1 Keep the API awake (kill the cold start)

Render free services sleep after 15 idle minutes, and the first request after a
nap takes ~30–60 s. A free monitor that pings the API every 10 minutes fixes it:

1. Create a free account at [cron-job.org](https://cron-job.org).
2. Add a job: URL `https://modubiz-api.onrender.com/v1/modules`, **every 10
   minutes**, save. The 401 response still counts as traffic and wakes the
   service.

### 10.2 Pre-seeded demo account (optional)

The repo has a script that creates a fresh user + org + module trials **through
the deployed API** (signup → login → org → switch-org → trials):

```bash
API_BASE_URL=https://modubiz-api.onrender.com node scripts/seed-e2e-env.mjs --out /tmp/demo-state.json
```

It prints the email/password it used and writes a Playwright storage-state file
(mainly useful for e2e journeys). For a human demo, plain signup (§9) is
simpler.

### 10.3 Custom domain (optional)

Both platforms allow a custom domain on the free tier (Vercel: **Settings →
Domains**; Render: **Settings → Custom Domain**). If you add one, update
`WEB_BASE_URL` on Render and `NEXT_PUBLIC_APP_URL` on Vercel to the new URL.

---

## 11. Troubleshooting

| Symptom                                                     | Likely cause → fix                                                                                                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API crashes at boot with a Zod error naming env vars        | A required env var is missing — the error lists exactly which. Add all rows from §6.2.                                                                     |
| Browser console: CORS / blocked by CORS                     | `WEB_BASE_URL` on Render doesn't exactly match the Vercel URL. Fix it (no trailing slash), then **Deploy** the API again (env changes trigger a redeploy). |
| `relation "core_currencies" does not exist` or signup fails | Migrations not run yet → do §7.                                                                                                                            |
| Checkout shows no currencies / FX                           | `pnpm db:seed` not run → do §7 step 2.                                                                                                                     |
| Migrations fail with `permission denied ... modubiz_app`    | The `modubiz_app` role doesn't exist yet on Neon → run the §5.2 SQL first, then re-run §7.                                                                 |
| Runtime errors `permission denied for table ...`            | `DATABASE_URL` must use the `modubiz_app` role — you accidentally used the Neon owner role.                                                                |
| `CREATE EXTENSION citext` fails during migration            | You ran migrations as a non-owner. Use the Neon console's default role URL for `DATABASE_MIGRATION_URL`.                                                   |
| First load after idle is slow / 502                         | Render cold start (~30–60 s). Wait and retry, or add the §10.1 keep-alive.                                                                                 |
| Web shows the "offline" page briefly                        | That's the PWA's offline fallback when the API is cold. Retry after the API wakes.                                                                         |
| Vercel build fails on `@modubiz/*` resolution               | Packages weren't built first — make sure the Build Command is exactly `pnpm --filter "@modubiz/*" build && pnpm build`.                                    |

## 12. Before you go public — security notes

This demo is **not production-hardened** (that's Phase 7 in `PLAN.md`):

- **Placeholder adapters are active**: fake Stripe (no real billing), in-memory
  cache/jobs (data lost on restart), no real email, dummy R2 storage. Trial and
  error flows work, but nothing "real" happens.
- **Secrets are demo secrets**: the JWT secrets and Neon password you set are
  visible in the dashboards. Never reuse them for production.
- **RLS is real, even in the demo**: keep `DATABASE_URL` on the `modubiz_app`
  role — switching it to the owner role would disable tenant isolation.
- **Before Phase 7** you'll want: real Redis + BullMQ, Stripe live keys +
  webhooks, Resend, object storage, Sentry/OTLP, rate limiting, stronger
  secrets, and a domain. Most of the env schema is already waiting for them.

---

_Companion docs: [`TECH_STACK.md`](./TECH_STACK.md) (locked stack, env vars),
[`DATA_MODEL.md`](./DATA_MODEL.md) (roles/RLS), [`PLAN.md`](../PLAN.md) (Phase 7
production hardening)._
