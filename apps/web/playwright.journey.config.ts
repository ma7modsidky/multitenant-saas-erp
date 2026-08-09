import { defineConfig } from '@playwright/test';

import baseConfig from './playwright.config';

/**
 * Journey-spec config — runs the `*-journey.e2e.spec.ts` specs against a
 * seeded E2E environment.
 *
 * The journey specs self-skip unless `E2E_BASE_URL` is set (they need an
 * authenticated session with module trials enabled). Seed that session first:
 *
 *   pnpm e2e:seed          # signup → org → inventory+POS trials → storageState
 *   pnpm test:e2e:journeys # this config: storageState + E2E_BASE_URL
 *
 * Defaults:
 *   - storageState: apps/web/e2e/.e2e-state.json (written by the seeder;
 *     gitignored). Override with E2E_STORAGE_STATE.
 *   - E2E_BASE_URL falls back to the web base URL so the journey specs' skip
 *     guard passes without the caller exporting it by hand. The config file is
 *     evaluated before workers fork, so the assignment reaches the specs.
 */
process.env.E2E_BASE_URL ??= baseConfig.use?.baseURL ?? 'http://localhost:3000';

const STATE_FILE = process.env.E2E_STORAGE_STATE ?? './e2e/.e2e-state.json';

export default defineConfig({
  ...baseConfig,
  // Only the journey specs — the invitation-flow spec signs itself up and
  // must NOT run with a seeded storage state (it tests the signed-out path).
  testMatch: /.*-journey\.e2e\.spec\.ts/,
  use: {
    ...baseConfig.use,
    storageState: STATE_FILE,
  },
});
