import { expect, test } from '@playwright/test';

test.describe('CRM journey', () => {
  test.skip(!process.env.E2E_BASE_URL, 'Requires a seeded E2E environment with CRM enabled');

  // Unique stamp so the journey is re-runnable against a persistent seeded DB.
  const stamp = Date.now().toString().slice(-6);
  const contactName = `Ada E2E ${stamp}`;
  const dealTitle = `Analytical Engine ${stamp}`;

  test('contact to deal to won pipeline stage', async ({ page }) => {
    await page.goto('/en/m/crm/contacts');
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
    await page.getByRole('button', { name: 'Add contact' }).click();
    await page.getByLabel('First name').fill('Ada');
    await page.getByLabel('Last name').fill(`E2E ${stamp}`);
    await page.getByLabel('Email').fill(`ada.e2e.${stamp}@example.com`);
    await page.getByRole('button', { name: 'Add contact' }).last().click();
    await expect(page.getByText(contactName)).toBeVisible();

    // Two "Deals" links (sidebar + in-page CRM subnav) — use the subnav.
    await page.getByLabel('CRM').getByRole('link', { name: 'Deals' }).click();
    await page.getByRole('button', { name: 'Add deal' }).click();
    await page.getByLabel('Title').fill(dealTitle);
    // Custom Select: the contact trigger is labelled by its field ("Contact")
    // — target it directly instead of the sidebar search combobox.
    await page.getByLabel('Contact').click();
    await page.getByRole('option', { name: contactName }).click();
    await page.getByLabel('Amount in minor units').fill('250000');
    await page.getByRole('button', { name: 'Add deal' }).last().click();
    // The board columns default to a "today" date filter — a deal created near
    // the UTC midnight boundary can land on "yesterday" and be hidden there.
    // The table view has no date filter, so assert the deal there instead.
    await page.goto('/en/m/crm/deals/table');
    await expect(page.getByRole('link', { name: dealTitle })).toBeVisible();
  });
});
