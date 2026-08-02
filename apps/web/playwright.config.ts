import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config — critical user journeys through the real browser
 * against the real API (see docs/TESTING.md §7 — E2E journeys).
 *
 * The webServer entries reuse already-running dev servers when they are up
 * (typical local workflow: `pnpm dev` in one terminal, `pnpm test:e2e` in
 * another) and start them from scratch otherwise (CI).
 */
const API_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const WEB_URL = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter api dev',
      url: `${API_URL}/v1/modules`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter web dev',
      url: `${WEB_URL}/en`,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
