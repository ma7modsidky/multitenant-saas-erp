import { expect, test } from '@playwright/test';

/**
 * E2E journey — locale routing and text direction (I18N).
 *
 * Guards the regression where every page rendered English no matter the URL:
 * `getRequestConfig` read the override-only `locale` param instead of the
 * `requestLocale` promise (the `[locale]` segment matched by the middleware),
 * so the server always fell back to the default locale — the URL changed to
 * /ar but `lang`/`dir` and the copy stayed English.
 *
 * The login page is public, so this needs no seed data — but the journey
 * config applies a seeded storageState, so this spec overrides it with an
 * empty (signed-out) state.
 *
 * @see apps/web/src/i18n/request.ts
 */
test.skip(!process.env.E2E_BASE_URL, 'Requires a running web app (E2E_BASE_URL)');

test.use({ storageState: { cookies: [], origins: [] } });

test('I18N: /ar renders Arabic + RTL, /en renders English + LTR', async ({ page }) => {
  // Arabic — server-rendered RTL + localized copy (the regression: the URL
  // went to /ar but lang/dir/copy stayed English).
  await page.goto('/ar/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'مرحباً بعودتك' })).toBeVisible();

  // English — LTR.
  await page.goto('/en/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
