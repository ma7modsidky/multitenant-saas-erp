import { expect, test } from '@playwright/test';

// PLAN §5.8 test: Inventory journey — create product → receive stock → adjust
// → low-stock alert. Requires a seeded E2E environment with inventory enabled
// (same guard as the CRM journey spec — skipped without E2E_BASE_URL).

test.describe('Inventory journey', () => {
  test.skip(!process.env.E2E_BASE_URL, 'Requires a seeded E2E environment with inventory enabled');

  test('create product, receive stock, adjust, and see the low-stock alert', async ({ page }) => {
    await page.goto('/en/m/inventory/products');
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();

    // Create a product with a reorder point so the low-stock state exists.
    await page.getByRole('button', { name: 'Add product' }).first().click();
    await page.getByLabel('Product name').fill('Widget Pro');
    await page.getByLabel('SKU').fill('WIDGET-1');
    await page.getByLabel('Reorder point').fill('5');
    await page.getByRole('button', { name: 'Add product' }).last().click();
    await expect(page.getByText('Widget Pro')).toBeVisible();

    // Stock page: no stock yet → below reorder point → Low stock badge. Rows
    // are grouped under a product header row, so the name and SKU render in
    // separate cells.
    await page.goto('/en/m/inventory/stock');
    await expect(page.getByRole('heading', { name: 'Stock levels' })).toBeVisible();
    await expect(page.getByText('Widget Pro')).toBeVisible();
    await expect(page.getByText('WIDGET-1')).toBeVisible();
    await expect(page.getByText('Low stock')).toBeVisible();

    // Receive 10 units → level lifts above the reorder point. The variant
    // picker is a searchable combobox: open it and pick the option.
    await page.getByRole('button', { name: 'Receive stock' }).first().click();
    await page.getByRole('button', { name: 'Select a product' }).click();
    await page.getByRole('option', { name: 'Widget Pro (WIDGET-1)' }).click();
    await page.getByLabel('Quantity').fill('10');
    // exact:true — the row action buttons carry "Receive stock: <SKU>" names.
    await page.getByRole('button', { name: 'Receive stock', exact: true }).last().click();
    await expect(page.getByText('Stock received.')).toBeVisible();
    await expect(page.getByText('In stock')).toBeVisible();

    // Adjust −2 with a reason → still above reorder point, no alert.
    await page.getByRole('button', { name: 'Adjust stock' }).first().click();
    await page.getByRole('button', { name: 'Select a product' }).click();
    await page.getByRole('option', { name: 'Widget Pro (WIDGET-1)' }).click();
    await page.getByLabel('Quantity (negative to remove)').fill('-2');
    await page.getByLabel('Reason code').fill('damaged');
    await page.getByRole('button', { name: 'Adjust stock', exact: true }).last().click();
    await expect(page.getByText('Stock adjusted.')).toBeVisible();

    // The append-only ledger shows the receipt + adjustment rows.
    await page.goto('/en/m/inventory/stock/movements');
    await expect(page.getByRole('heading', { name: 'Stock movements' })).toBeVisible();
    await expect(page.getByText('Receipt', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Adjustment', { exact: true }).first()).toBeVisible();
  });
});
