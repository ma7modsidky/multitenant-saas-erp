import { expect, test } from '@playwright/test';

// PLAN §6.7 test: POS journey — create product → receive stock → create
// register → open shift → sell → refund → close shift with zero variance.
// Requires a seeded E2E environment with POS enabled (same guard as the CRM
// and inventory journey specs — skipped without E2E_BASE_URL).
//
// The flow mirrors the inventory journey's conventions: unique SKU/code
// stamps (INV-10 rejects a duplicate SKU on a second run), combobox picks by
// role, and exact:true to disambiguate the toolbar/row buttons from the form
// submit (which share their label).

test.describe('POS journey', () => {
  test.skip(!process.env.E2E_BASE_URL, 'Requires a seeded E2E environment with POS enabled');

  // Unique stamp so the journey is re-runnable against a persistent seeded DB.
  const stamp = Date.now().toString().slice(-6);
  const productName = `POS Widget ${stamp}`;
  const sku = `POS-${stamp}`;
  const registerName = `POS Register ${stamp}`;
  const registerCode = `REG-${stamp}`;

  test('open shift, sell, refund, and close the shift with zero variance', async ({ page }) => {
    // 1. Create a priced product — needed for the sellable catalog (POS-11).
    await page.goto('/en/m/inventory/products');
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await page.getByRole('button', { name: 'Add product' }).first().click();
    await page.getByLabel('Product name').fill(productName);
    await page.getByLabel('SKU').fill(sku);
    // Selling price in minor units → $25.00.
    await page.getByLabel('Selling price').fill('2500');
    await page.getByRole('button', { name: 'Add product' }).last().click();
    await expect(page.getByText(productName)).toBeVisible();

    // 2. Receive 10 units — this also lazily creates the "Default Warehouse".
    await page.goto('/en/m/inventory/stock');
    await expect(page.getByRole('heading', { name: 'Stock levels' })).toBeVisible();
    await page.getByRole('button', { name: 'Receive stock' }).first().click();
    // The variant combobox trigger's accessible name is its field label
    // ("Product"), not the placeholder — exact:true to skip the columnheader.
    await page.getByRole('button', { name: 'Product', exact: true }).click();
    await page.getByRole('option', { name: `${productName} (${sku})` }).click();
    await page.getByLabel('Quantity').fill('10');
    // exact:true — the stock-table row actions carry "Receive stock: <SKU>".
    await page.getByRole('button', { name: 'Receive stock', exact: true }).last().click();
    await expect(page.getByText('Stock received.')).toBeVisible();

    // 3. Create a register on the default warehouse.
    await page.goto('/en/m/pos');
    await expect(page.getByRole('heading', { name: 'Registers' })).toBeVisible();
    await page.getByRole('button', { name: 'Add register' }).first().click();
    await page.getByLabel('Register name').fill(registerName);
    await page.getByLabel('Register code').fill(registerCode);
    // Same combobox convention — the trigger is named by its field label
    // ("Selling warehouse"), not the placeholder.
    await page.getByRole('button', { name: 'Selling warehouse', exact: true }).click();
    await page.getByRole('option', { name: 'Default warehouse' }).click();
    await page.getByRole('button', { name: 'Add register' }).last().click();
    await expect(page.getByText('Register created.')).toBeVisible();

    // 4. Open a shift with a zero float. The row action carries the register
    //    name in its accessible name (aria-label), so it never collides with
    //    the form submit button ("Open shift").
    await page.getByRole('button', { name: `Open a shift on ${registerName}` }).click();
    await page.getByLabel(/Opening float/).fill('0');
    await page.getByRole('button', { name: 'Open shift', exact: true }).click();
    await expect(page.getByText('Shift opened.')).toBeVisible();

    // 5. Checkout: use the register row's "New sale" action — it preselects
    //    the register via ?registerId= in the URL. A re-run against a
    //    persistent DB has multiple registers, so a bare /checkout visit
    //    would preselect the FIRST register (a previous run's, shift closed);
    //    the row action always targets THIS register (shift open).
    await page.locator('tr', { hasText: registerName }).getByRole('link', { name: 'New sale' }).click();
    await expect(page.getByRole('heading', { name: 'New sale' })).toBeVisible();
    await expect(page.getByText('Shift open — ready to sell')).toBeVisible();

    // 5a. Link the sale to a NEW customer created inline (POS-18) — the
    //     inline form creates the contact, then the picker selects it.
    const customerFirstName = `Walk${stamp}`;
    const customerLastName = `In${stamp}`;
    await page.getByRole('button', { name: 'New customer' }).click();
    await page.getByLabel('First name').fill(customerFirstName);
    await page.getByLabel('Last name').fill(customerLastName);
    await page.getByLabel('Email').fill(`walkin${stamp}@example.com`);
    await page.getByRole('button', { name: 'Add customer' }).click();
    // The customer combobox trigger now carries the selected contact's name.
    await expect(page.getByRole('button', { name: `${customerFirstName} ${customerLastName}` })).toBeVisible();

    await page.getByRole('button', { name: 'Search products…' }).click();
    await page.getByRole('option', { name: `${productName} (${sku})` }).click();
    await page.getByLabel(/Tendered/).fill('3000');
    await page.getByRole('button', { name: 'Complete sale' }).click();
    await expect(page.getByText('Sale completed successfully.')).toBeVisible();
    await page.getByRole('link', { name: 'View sale' }).click();
    await expect(page.getByRole('heading', { name: 'Sale' })).toBeVisible();
    // The linked customer resolves on the sale detail (customerContactId → CRM).
    await expect(page.getByRole('link', { name: `${customerFirstName} ${customerLastName}` })).toBeVisible();

    // 6. Refund the line in full through the sale's own register (which still
    //    has an open shift — POS-23).
    await page.getByRole('button', { name: 'Refund', exact: true }).click();
    await page.getByLabel('Reason').fill('Customer return');
    await page.getByRole('button', { name: 'Process refund' }).click();
    await expect(page.getByText('Refund recorded.')).toBeVisible();

    // 7. Close the shift: expected cash = float + cash sales − cash refunds
    //    (POS-5) = 0 + 2500 − 2500 = 0, so counting $0 gives zero variance.
    //    Assert the actual values, not just "Shift closed." — the regex
    //    matches a formatted zero ($0.00, €0.00, ¥0…) while a non-zero
    //    (e.g. $25.00) fails the [^0-9]*0 clause, so a broken expected-cash
    //    calculation can never pass silently.
    await page.goto('/en/m/pos');
    await page.getByRole('button', { name: `Close the shift on ${registerName}` }).click();
    await page.getByLabel(/Counted cash/).fill('0');
    await page.getByRole('button', { name: 'Close shift', exact: true }).click();
    await expect(
      page.getByText(/Shift closed\. Expected [^0-9]*0(\.0+)?\. Variance \+?[^0-9]*0(\.0+)?\./),
    ).toBeVisible();
  });
});
