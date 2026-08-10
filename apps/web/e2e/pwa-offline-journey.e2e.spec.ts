import { expect, test } from '@playwright/test';

// PLAN §6.7 test: PWA offline shell — with the service worker controlling the
// page, dropping the network must still open the POS checkout from cache
// (offline-first routing), and a never-visited route falls back to the
// self-contained /offline.html page. Requires a seeded E2E environment (the
// journey config provides the authenticated storageState) — skipped without
// E2E_BASE_URL, same guard as the other journey specs.

test.describe('PWA offline shell', () => {
  test.skip(!process.env.E2E_BASE_URL, 'Requires a seeded E2E environment with an authenticated session');

  test('checkout opens with no network, and unknown routes fall back to offline.html', async ({ page, context }) => {
    // 1. Load the checkout online — this registers /sw.js and lets the service
    //    worker take control (skipWaiting + clients.claim) and warm its caches.
    await page.goto('/en/m/pos/checkout');
    await expect(page.getByRole('heading', { name: 'New sale' })).toBeVisible();

    // 2. Ensure the SW is controlling this page before going offline.
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'New sale' })).toBeVisible();

    // 3. Drop the network — the POS shell must still open from the SW cache.
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'New sale' })).toBeVisible();

    // 4. A never-visited route (nothing cached) falls back to /offline.html —
    //    the self-contained, zero-network page. Assert the locale-agnostic
    //    [data-i18n="title"] element: the seeded storageState may carry a
    //    NEXT_LOCALE cookie, so the heading text differs per environment.
    await page.goto('/en/some/never/visited/route');
    await expect(page.locator('[data-i18n="title"]')).toBeVisible();

    // 5. Restore the network for subsequent tests.
    await context.setOffline(false);
    await page.goto('/en/m/pos/checkout');
    await expect(page.getByRole('heading', { name: 'New sale' })).toBeVisible();
  });
});
