// @vitest-environment jsdom
//
// Unit tests for the grouped products table (products-view.tsx):
//   - Product group headers render a link, status + variant-count badges, and
//     product-scoped actions (Edit / Archive / Unarchive).
//   - Every variant renders as a row under its product (active + archived,
//     INV-11 history never lost).
//   - Per-variant Archive (INV-11) and Unarchive (INV-11 inverse) run through
//     the confirm dialog and call the right mutation with {variantId, productId}.
//   - Editing a specific variant opens the product form prefilled with THAT
//     variant, and saving calls updateProduct + updateVariant.

import messages from '@modubiz/i18n/messages/en';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InventoryPage, InventoryProduct, InventoryProductDetail } from '@/lib/api/resources';

// vi.mock factories are hoisted above top-level data, so the mutation mocks
// (referenced from the hooks factory) live in vi.hoisted().
const h = vi.hoisted(() => {
  const mutation = () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  });
  return {
    mutations: {
      createProduct: mutation(),
      updateProduct: mutation(),
      updateVariant: mutation(),
      archiveProduct: mutation(),
      unarchiveProduct: mutation(),
      archiveVariant: mutation(),
      unarchiveVariant: mutation(),
    },
  };
});

// Query results are mutable per test (swapped before render).
let productsData: InventoryPage<InventoryProduct> = { items: [], total: 0, page: 1, pageSize: 12 };
let editDetail: InventoryProductDetail | undefined;

vi.mock('@/features/inventory/hooks', () => ({
  useInventoryProducts: () => ({ data: productsData, isPending: false }),
  useCurrencies: () => ({ data: undefined }),
  useInventoryProduct: () => ({ data: editDetail, isPending: false }),
  useOrgBaseCurrency: () => 'USD',
  useInventoryMutations: () => h.mutations,
}));

// The products view renders inside ModuleGate; entitlement state is out of
// scope here, so the gate renders its children.
vi.mock('@/lib/entitlements', () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

// useInventoryListUrlState reads/updates URL state; a fresh empty query +
// a no-op router keep the view in its default (unfiltered, page 1) state.
// usePathname feeds the module nav's active-tab highlight.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/en/m/inventory/products',
}));

import { ProductsView } from '../products-view';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ACTIVE_PRIMARY = {
  id: 'var-2',
  sku: 'WIDGET-2',
  price: { amountMinor: '1200', currency: 'USD' },
  reorderPoint: '5',
  taxRateBp: 0,
  isActive: true,
};
const ACTIVE_SECONDARY = {
  id: 'var-1',
  sku: 'WIDGET-1',
  price: { amountMinor: '1000', currency: 'USD' },
  reorderPoint: '5',
  taxRateBp: 0,
  isActive: true,
};

function product(id: string, name: string, variants: InventoryProduct['variants']): InventoryProduct {
  // Every fixture product carries at least one variant.
  const primary = variants[0]!;
  return {
    id,
    nameI18n: { en: name },
    isActive: variants.some((variant) => variant.isActive),
    variantId: primary.id,
    sku: primary.sku,
    price: primary.price,
    reorderPoint: primary.reorderPoint,
    createdAt: null,
    updatedAt: null,
    variantCount: variants.filter((variant) => variant.isActive).length,
    variants,
  };
}

const WIDGET_PRO = product('prod-1', 'Widget Pro', [ACTIVE_PRIMARY, ACTIVE_SECONDARY]);
const OLD_WIDGET = product('prod-2', 'Old Widget', [
  {
    id: 'var-3',
    sku: 'OLD-1',
    price: { amountMinor: '900', currency: 'USD' },
    reorderPoint: '3',
    taxRateBp: 0,
    isActive: false,
  },
]);

/** The product-detail payload the edit flow fetches to prefill the form. */
function detailOf(prod: InventoryProduct): InventoryProductDetail {
  return {
    product: {
      id: prod.id,
      nameI18n: prod.nameI18n,
      descriptionI18n: {},
      isActive: prod.isActive,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdByUserId: null,
      updatedByUserId: null,
    },
    variants: prod.variants.map((variant) => ({
      id: variant.id,
      productId: prod.id,
      sku: variant.sku,
      barcode: null,
      price: variant.price,
      cost: { amountMinor: '400', currency: 'USD' },
      reorderPoint: variant.reorderPoint,
      reorderQuantity: '10',
      taxRateBp: variant.taxRateBp,
      isActive: variant.isActive,
      createdByUserId: null,
      updatedByUserId: null,
      stock: [],
    })),
    movements: [],
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider messages={messages} locale="en">
      <ProductsView />
    </NextIntlClientProvider>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ProductsView — grouped products table', () => {
  beforeEach(() => {
    for (const mutation of Object.values(h.mutations)) mutation.mutateAsync.mockClear();
    productsData = { items: [WIDGET_PRO, OLD_WIDGET], total: 2, page: 1, pageSize: 12 };
    editDetail = undefined;
  });

  it('renders a product header row per product with its variants beneath', () => {
    renderView();

    // Group headers: name links to the product detail pages.
    expect(screen.getByRole('link', { name: 'Widget Pro' })).toHaveAttribute('href', '/en/m/inventory/products/prod-1');
    expect(screen.getByRole('link', { name: 'Old Widget' })).toHaveAttribute('href', '/en/m/inventory/products/prod-2');

    // Every variant renders as its own row (INV-11: archived rows stay listed).
    expect(screen.getByText('WIDGET-2')).toBeInTheDocument();
    expect(screen.getByText('WIDGET-1')).toBeInTheDocument();
    expect(screen.getByText('OLD-1')).toBeInTheDocument();

    // Status badges — product headers + per-variant rows:
    //   Widget Pro (active) header + WIDGET-2 + WIDGET-1 rows → 3× Active.
    //   Old Widget (archived) header + OLD-1 row → 2× Archived.
    expect(screen.getAllByText('Active')).toHaveLength(3);
    expect(screen.getAllByText('Archived')).toHaveLength(2);

    // Variant-count badge: Widget Pro has 2 sellable variants.
    expect(screen.getByText('2')).toBeInTheDocument();

    // Grouped-table column headers.
    expect(screen.getByText('SKU')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('Reorder point')).toBeInTheDocument();
  });

  it('archives ONE variant from its row after confirmation (INV-11)', async () => {
    const user = userEvent.setup();
    renderView();

    const row = screen.getByText('WIDGET-2').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Archive' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/WIDGET-2/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() =>
      expect(h.mutations.archiveVariant.mutateAsync).toHaveBeenCalledWith({ variantId: 'var-2', productId: 'prod-1' }),
    );
    expect(await screen.findByText('Variant archived.')).toBeInTheDocument();
  });

  it('unarchives ONE archived variant from its row after confirmation (INV-11 inverse)', async () => {
    const user = userEvent.setup();
    renderView();

    const row = screen.getByText('OLD-1').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Unarchive' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/OLD-1/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Unarchive' }));

    await waitFor(() =>
      expect(h.mutations.unarchiveVariant.mutateAsync).toHaveBeenCalledWith({
        variantId: 'var-3',
        productId: 'prod-2',
      }),
    );
    expect(await screen.findByText('Variant unarchived.')).toBeInTheDocument();
  });

  it('archives/restores at product level from the group header', async () => {
    const user = userEvent.setup();
    renderView();

    // Archive the whole product from the Widget Pro header.
    const widgetHeader = screen.getByRole('link', { name: 'Widget Pro' }).closest('tr')!;
    await user.click(within(widgetHeader).getByRole('button', { name: 'Archive' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(h.mutations.archiveProduct.mutateAsync).toHaveBeenCalledWith('prod-1'));
    expect(await screen.findByText('Product archived.')).toBeInTheDocument();

    // Restore the fully-archived product from the Old Widget header.
    const oldHeader = screen.getByRole('link', { name: 'Old Widget' }).closest('tr')!;
    await user.click(within(oldHeader).getByRole('button', { name: 'Unarchive' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unarchive' }));
    await waitFor(() => expect(h.mutations.unarchiveProduct.mutateAsync).toHaveBeenCalledWith('prod-2'));
    expect(await screen.findByText('Product unarchived.')).toBeInTheDocument();
  });

  it('editing a specific variant prefills the form with THAT variant (not the primary)', async () => {
    editDetail = detailOf(WIDGET_PRO);
    const user = userEvent.setup();
    renderView();

    // WIDGET-1 is the non-primary variant — editing its row must prefill its
    // own SKU, not the primary WIDGET-2.
    const row = screen.getByText('WIDGET-1').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));

    const skuInput = await screen.findByLabelText('SKU');
    expect(skuInput).toHaveValue('WIDGET-1');

    // Saving renames the product and edits THAT variant (INV-10 kept intact).
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(h.mutations.updateProduct.mutateAsync).toHaveBeenCalledWith({
        id: 'prod-1',
        nameI18n: { en: 'Widget Pro' },
      }),
    );
    await waitFor(() =>
      expect(h.mutations.updateVariant.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 'prod-1', variantId: 'var-1', sku: 'WIDGET-1' }),
      ),
    );
    expect(await screen.findByText('Product updated.')).toBeInTheDocument();
  });

  it('retyping the edited variant SKU in a different case is not a false duplicate (INV-10 self-exclusion)', async () => {
    editDetail = detailOf(WIDGET_PRO);
    const user = userEvent.setup();
    renderView();

    const row = screen.getByText('WIDGET-1').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));

    // Same SKU, different casing: the edited variant's own SKU is excluded
    // case-insensitively from the form's duplicate guard, matching the
    // backend's INV-10 rule — so this must NOT surface a duplicate error.
    const skuInput = await screen.findByLabelText('SKU');
    await user.clear(skuInput);
    await user.type(skuInput, 'widget-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(h.mutations.updateVariant.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 'prod-1', variantId: 'var-1', sku: 'widget-1' }),
      ),
    );
  });

  it('shows the empty state when there are no products', () => {
    productsData = { items: [], total: 0, page: 1, pageSize: 12 };
    renderView();

    expect(screen.getByText('No products yet. Add your first product to start tracking stock.')).toBeInTheDocument();
  });
});
