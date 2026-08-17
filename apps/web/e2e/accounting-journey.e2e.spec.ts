import { expect, test } from '@playwright/test';

// PLAN §7.8 test: Accounting journey — chart of accounts → post journal entry
// → issue invoice → apply payment. Requires a seeded E2E environment with
// accounting enabled (same guard as the other journey specs — skipped without
// E2E_BASE_URL).

test.describe('Accounting journey', () => {
  test.skip(!process.env.E2E_BASE_URL, 'Requires a seeded E2E environment with accounting enabled');

  test('view the COA, post a journal entry, issue an invoice, and apply a payment', async ({ page }) => {
    // Chart of accounts — the default SME chart is lazily seeded on first read.
    await page.goto('/en/m/accounting/coa');
    await expect(page.getByRole('heading', { name: 'Chart of accounts' })).toBeVisible();
    await expect(page.getByText('1000')).toBeVisible();

    // Post a manual journal entry (one debit line, one credit line).
    await page.goto('/en/m/accounting/journal');
    await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible();
    await page.getByRole('button', { name: 'Chart of accounts' }).first().click();
    await page.getByRole('option', { name: /Cash/ }).first().click();
    await page.getByLabel('Debit').fill('10000');
    await page.getByRole('button', { name: 'Add line' }).click();
    await page.getByRole('button', { name: 'Select an account…' }).last().click();
    await page
      .getByRole('option', { name: /Revenue/ })
      .first()
      .click();
    await page.getByLabel('Credit').last().fill('10000');
    await page.getByRole('button', { name: 'Post entry' }).click();
    await expect(page.getByText(/Entry JE-/)).toBeVisible();

    // Issue an invoice for a customer with two lines.
    await page.goto('/en/m/accounting/invoices');
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
    await page.getByLabel('Customer').fill('Acme Trading');
    await page.getByLabel('Item').fill('Consulting services');
    await page.getByLabel('Unit price').fill('50000');
    await page.getByRole('button', { name: 'Issue invoice' }).click();
    await expect(page.getByText(/Invoice /)).toBeVisible();
    await expect(page.getByText('Acme Trading')).toBeVisible();

    // Apply a partial payment against the issued invoice.
    await page.getByRole('button', { name: 'Pay', exact: true }).first().click();
    await page.getByLabel(/Amount/).fill('20000');
    await page.getByRole('button', { name: 'Pay', exact: true }).last().click();
    await expect(page.getByText('Payment applied.')).toBeVisible();
    await expect(page.getByText('Partially paid')).toBeVisible();
  });
});
