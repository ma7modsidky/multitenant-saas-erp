import { expect, test } from '@playwright/test';

test.describe('CRM journey', () => {
  test.skip(!process.env.E2E_BASE_URL, 'Requires a seeded E2E environment with CRM enabled');

  test('contact to deal to won pipeline stage', async ({ page }) => {
    await page.goto('/en/m/crm/contacts');
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
    await page.getByRole('button', { name: 'Add contact' }).click();
    await page.getByLabel('First name').fill('Ada');
    await page.getByLabel('Last name').fill('Lovelace');
    await page.getByLabel('Email').fill('ada.crm@example.com');
    await page.getByRole('button', { name: 'Add contact' }).last().click();
    await expect(page.getByText('Ada Lovelace')).toBeVisible();

    await page.getByRole('link', { name: 'Deals' }).click();
    await page.getByRole('button', { name: 'Add deal' }).click();
    await page.getByLabel('Title').fill('Analytical Engine');
    // Custom Select: click the Contact trigger (the first combobox in the
    // deal form), then the option in the popover list.
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'Ada Lovelace' }).click();
    await page.getByLabel('Amount in minor units').fill('250000');
    await page.getByRole('button', { name: 'Add deal' }).last().click();
    await expect(page.getByText('Analytical Engine')).toBeVisible();
  });
});
