// @vitest-environment jsdom
//
// Unit tests for the tax rates view (tax-rates-view.tsx, ACC-11):
//   - The catalog table renders code, rate (as %), default badge, and status.
//   - '+ Add tax rate' opens the create form; submitting converts the percent
//     to basis points with integer math (15 → 1500, 2.5 → 250) — hard rule #3.
//   - Editing prefills the form and submits a PATCH of only the changed fields.
//   - Deactivate/activate drives updateTaxRate with isActive.

import messages from '@modubiz/i18n/messages/en';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountingAccount, AccountingTaxRate } from '@/lib/api/resources';

const h = vi.hoisted(() => {
  const mutation = (resolved: unknown) => ({
    mutateAsync: vi.fn().mockResolvedValue(resolved),
    isPending: false,
  });
  return {
    createTaxRate: mutation({ taxRateId: 'rate-1', code: 'VAT-STD' }),
    updateTaxRate: mutation({ taxRateId: 'rate-1' }),
  };
});

let rates: { items: AccountingTaxRate[] };
let coa: { items: AccountingAccount[] };

vi.mock('@/features/accounting/hooks', () => ({
  useAccountingTaxRates: () => ({ data: rates, isPending: false }),
  useAccountingCoa: () => ({ data: coa, isPending: false }),
  useAccountingMutations: () => ({
    createTaxRate: h.createTaxRate,
    updateTaxRate: h.updateTaxRate,
  }),
}));

vi.mock('@/lib/entitlements', () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/permissions', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { TaxRatesView } from '../tax-rates-view';

const STANDARD: AccountingTaxRate = {
  id: 'rate-std',
  code: 'VAT-STD',
  nameI18n: { en: 'VAT 15%' },
  rateBp: 1500,
  type: 'standard',
  taxBasis: 'exclusive',
  coaAccountId: 'a-2100',
  coaAccountCode: '2100',
  coaAccountNameI18n: { en: 'coa.vat_payable' },
  isDefault: true,
  effectiveFrom: '2026-01-01',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <TaxRatesView />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rates = { items: [STANDARD] };
  coa = {
    items: [
      {
        id: 'a-2100',
        code: '2100',
        nameI18n: { en: 'coa.vat_payable' },
        type: 'liability',
        isSystem: true,
        isActive: true,
      },
      {
        id: 'a-2200',
        code: '2200',
        nameI18n: { en: 'coa.vat_receivable' },
        type: 'asset',
        isSystem: true,
        isActive: true,
      },
    ],
  };
});

describe('TaxRatesView', () => {
  it('renders the catalog with rate, default badge, and GL account', () => {
    renderView();
    expect(screen.getByText('VAT-STD')).toBeInTheDocument();
    expect(screen.getByText('VAT 15%')).toBeInTheDocument();
    expect(screen.getByText('15%')).toBeInTheDocument();
    // "Default" appears both as the column header and the badge.
    expect(screen.getAllByText('Default').length).toBeGreaterThan(0);
    expect(screen.getByText(/2100/)).toBeInTheDocument();
  });

  it('renders the empty state when there are no rates', () => {
    rates = { items: [] };
    renderView();
    expect(screen.getByText(/No tax rates yet/)).toBeInTheDocument();
  });

  it('creates a rate and converts percent to basis points with integer math', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole('button', { name: 'Add tax rate' }));
    await user.type(screen.getByLabelText('Code'), 'VAT-RED');
    await user.type(screen.getByLabelText('Name'), 'Reduced 2.5%');
    await user.clear(screen.getByLabelText('Rate (%)'));
    await user.type(screen.getByLabelText('Rate (%)'), '2.5');
    await user.click(screen.getByRole('button', { name: 'Create tax rate' }));

    await waitFor(() => expect(h.createTaxRate.mutateAsync).toHaveBeenCalledTimes(1));
    expect(h.createTaxRate.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'VAT-RED',
        rateBp: 250,
        type: 'standard',
        taxBasis: 'exclusive',
        isDefault: false,
      }),
    );
  });

  it('edits a rate prefilled from the row and PATCHes only changed fields', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('button', { name: 'Save changes' }).closest('form')!;
    expect(within(form).getByLabelText('Code')).toHaveValue('VAT-STD');
    expect(within(form).getByLabelText('Name')).toHaveValue('VAT 15%');

    await user.clear(within(form).getByLabelText('Name'));
    await user.type(within(form).getByLabelText('Name'), 'VAT 15.5%');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(h.updateTaxRate.mutateAsync).toHaveBeenCalledTimes(1));
    expect(h.updateTaxRate.mutateAsync).toHaveBeenCalledWith({
      taxRateId: 'rate-std',
      patch: { nameI18n: { en: 'VAT 15.5%' } },
    });
  });

  it('deactivates a rate via the confirm dialog', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(h.updateTaxRate.mutateAsync).toHaveBeenCalledTimes(1));
    expect(h.updateTaxRate.mutateAsync).toHaveBeenCalledWith({
      taxRateId: 'rate-std',
      patch: { isActive: false },
    });
  });
});
