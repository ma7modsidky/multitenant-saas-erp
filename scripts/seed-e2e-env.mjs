#!/usr/bin/env node
/**
 * Seed a local E2E environment for the Playwright journey specs.
 *
 * The journey specs (`apps/web/e2e/*-journey.e2e.spec.ts`) self-skip unless a
 * seeded environment exists: an authenticated session whose org has the module
 * trials enabled. There is no committed fixture for that, so this script
 * creates one through the real API:
 *
 *   signup → login → create org (USD) → switch-org → enable module trials
 *
 * and writes a Playwright storageState JSON (session tokens + authed cookie)
 * that `apps/web/playwright.journey.config.ts` injects into the browser.
 *
 * Usage:
 *   pnpm e2e:seed                                  # crm + inventory + pos trials
 *   pnpm e2e:seed -- --modules inventory,pos       # narrower set
 *   pnpm e2e:seed -- --out /tmp/e2e-state.json     # custom state path
 *
 * Environment (dev stack must be running — `pnpm docker:up && pnpm dev`):
 *   API_BASE_URL  (default http://localhost:4000)
 *   WEB_BASE_URL  (default http://localhost:3000)
 *
 * Re-runnable: every run creates a FRESH user + org (unique stamps), so it
 * never conflicts with data already in the persistent dev DB.
 *
 * NOTE: plain script at repo root (like scripts/lint-staged-eslint.cjs) —
 * reads process.env directly, which AGENTS.md rule 9 exempts for tooling.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── CLI / env ────────────────────────────────────────────────────────────────

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function parseArg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] !== undefined ? process.argv[idx + 1] : undefined;
}

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const requestedModules = (parseArg('--modules') ?? 'crm,inventory,pos').split(',').map((s) => s.trim()).filter(Boolean);
const outPath = resolve(REPO_ROOT, parseArg('--out') ?? 'apps/web/e2e/.e2e-state.json');
const orgNamePrefix = parseArg('--org-name') ?? 'E2E Org';

// ── API helpers ───────────────────────────────────────────────────────────────

async function request(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

// ── Seed: signup → login → org → switch-org → trials ─────────────────────────

const stamp = Date.now().toString().slice(-8);
const email = `e2e-${stamp}@example.com`;
const password = 'E2eSeedPass123!';
const orgName = `${orgNamePrefix} ${stamp}`;
const orgSlug = `e2e-${stamp}`;

await request('/v1/auth/signup', {
  method: 'POST',
  body: { name: 'E2E Seed User', email, password, preferredLocale: 'en' },
});
console.log('✅ signup', email);

const { data: login } = await request('/v1/auth/login', { method: 'POST', body: { email, password } });

// Resolve module order (dependencies first, BILL-8). GET /v1/modules carries
// the AuthGuard in practice (the @PublicRoute only bypasses tenant context),
// so fetch it with the login token.
const { data: catalog } = await request('/v1/modules', { token: login.accessToken });
const byKey = new Map(catalog.map((mod) => [mod.key, mod]));

const ordered = [];
const visit = (key) => {
  if (ordered.includes(key)) return;
  const mod = byKey.get(key);
  if (!mod) {
    throw new Error(
      `Unknown module '${key}'. Catalog has: ${catalog.map((m) => m.key).join(', ')}`,
    );
  }
  for (const dep of mod.dependsOn ?? []) visit(dep);
  ordered.push(key);
};
for (const key of requestedModules) visit(key);

console.log(`📦 Enabling trials in dependency order: ${ordered.join(' → ')}`);

const { data: org } = await request('/v1/organizations', {
  method: 'POST',
  token: login.accessToken,
  body: { name: orgName, slug: orgSlug, countryCode: 'US', timezone: 'UTC', baseCurrency: 'USD' },
});
console.log('✅ org', org.id);

// switch-org mints org-scoped tokens (roles/permissions live in the JWT claims).
const { data: switched } = await request('/v1/auth/switch-org', {
  method: 'POST',
  token: login.accessToken,
  body: { organizationId: org.id },
});

for (const moduleKey of ordered) {
  await request(`/v1/organizations/${org.id}/billing/trial`, {
    method: 'POST',
    token: switched.accessToken,
    body: { moduleKey },
  });
  console.log(`✅ trial: ${moduleKey}`);
}

// ── Write Playwright storageState ─────────────────────────────────────────────

const webHost = new URL(WEB_BASE_URL).hostname;
const storageState = {
  cookies: [
    {
      name: 'modubiz_authed',
      value: '1',
      domain: webHost,
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ],
  origins: [
    {
      origin: WEB_BASE_URL,
      localStorage: [
        {
          name: 'modubiz.tokens',
          value: JSON.stringify({
            accessToken: switched.accessToken,
            refreshToken: switched.refreshToken,
          }),
        },
        {
          name: 'modubiz.user',
          value: JSON.stringify({
            id: login.user.id,
            email: login.user.email,
            name: login.user.name,
            preferredLocale: 'en',
            emailVerified: login.user.emailVerified,
          }),
        },
      ],
    },
  ],
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(storageState, null, 2));
console.log('✅ storageState written to', outPath);
console.log('');
console.log('Run the journeys:');
console.log('  pnpm test:e2e:journeys');
console.log('  # or directly:');
console.log(`  E2E_BASE_URL=${WEB_BASE_URL} pnpm --filter web exec playwright test --config=playwright.journey.config.ts`);
