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

    // Editing a company-less contact must not 400: the form submits an empty
    // company select as '' while the PATCH schema requires a UUID or null, so
    // the client normalizes it to null. Success closes the edit form, which
    // re-renders the Edit button.
    await page
      .getByRole('link', { name: new RegExp(contactName) })
      .first()
      .click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

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
    // The board columns default to a "today" date filter, now computed in UTC
    // (the API stores updated_at as UTC instants). A deal created here is
    // always inside today's window, so it must appear on its stage column
    // immediately — the table view also lists it.
    await expect(page.getByRole('link', { name: dealTitle })).toBeVisible();
    await page.goto('/en/m/crm/deals/table');
    await expect(page.getByRole('link', { name: dealTitle })).toBeVisible();
  });
});
