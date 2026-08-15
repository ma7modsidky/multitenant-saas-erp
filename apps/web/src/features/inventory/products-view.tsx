'use client';

import { ArchiveRestore, Package, PackagePlus, Pencil, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { INVENTORY_PAGE_SIZE } from '@/lib/api/resources';
import { ModuleGate } from '@/lib/entitlements';

import { inventoryErrorKey } from './errors';
import { ProductForm } from './forms';
import { InventoryModuleNav, InventoryPageHeader } from './module-nav';
import { useCurrencies, useInventoryMutations, useInventoryProduct, useInventoryProducts } from './hooks';
import { localizedLabel } from './labels';
import { formatMinorAmount } from './money';
import type { ProductFormValues } from './schemas';
import { InventoryPagination, useInventoryListUrlState } from './table-shared';

/**
 * Per-variant row actions (kept small so the variant-row callback stays under
 * the lint line budget): active variants get Edit + Archive (INV-11), archived
 * variants get Restore (INV-11 inverse). The cell wrapper (`<td>`) belongs to
 * the caller — this renders the buttons only.
 */
function VariantRowActions({
  isActive,
  onEdit,
  onArchive,
  onRestore,
}: {
  isActive: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const t = useTranslations('modules.inventory');
  if (!isActive) {
    return (
      <Button variant="ghost" size="sm" onClick={onRestore}>
        <ArchiveRestore className="size-4" aria-hidden="true" />
        <span className="ms-1">{t('variants.unarchive')}</span>
      </Button>
    );
  }
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={onEdit}>
        <Pencil className="size-4" aria-hidden="true" />
        <span className="ms-1">{t('variants.edit')}</span>
      </Button>
      <Button variant="ghost" size="sm" onClick={onArchive}>
        {t('variants.archive')}
      </Button>
    </div>
  );
}

export function ProductsView() {
  const t = useTranslations('modules.inventory');
  const global = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const basePath = `/${locale}/m/inventory/products`;
  const { q, page, searchInput, setSearchInput, update } = useInventoryListUrlState({ basePath });
  const status = searchParams.get('status') ?? '';
  const hasActiveFilters = Boolean(q || status);
  const { data, isPending } = useInventoryProducts({
    page,
    pageSize: INVENTORY_PAGE_SIZE,
    ...(q ? { search: q } : {}),
    ...(status === 'active' || status === 'archived' ? { status } : {}),
  });
  const { data: currencies } = useCurrencies();
  const {
    createProduct,
    updateProduct,
    updateVariant,
    archiveProduct,
    unarchiveProduct,
    archiveVariant,
    unarchiveVariant,
  } = useInventoryMutations();

  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);
  const [unarchiveTarget, setUnarchiveTarget] = useState<{ id: string; name: string } | null>(null);
  // Per-variant actions (INV-11) — archive/restore ONE variant right from the
  // list, mirroring the product detail view. productId feeds the mutation's
  // product-detail invalidation.
  const [variantArchiveTarget, setVariantArchiveTarget] = useState<{
    productId: string;
    id: string;
    name: string;
  } | null>(null);
  const [variantUnarchiveTarget, setVariantUnarchiveTarget] = useState<{
    productId: string;
    id: string;
    name: string;
  } | null>(null);
  // Edit opens the product form prefilled from ONE variant: the group header
  // edits the primary variant, a variant row edits that variant.
  const [editing, setEditing] = useState<{ productId: string; variantId: string | null } | null>(null);

  // Edit mode fetches the full product detail on demand to prefill the form
  // (the list row carries only the variant display fields).
  const { data: editDetail } = useInventoryProduct(editing?.productId ?? '', editing !== null);
  const editingVariant = editDetail
    ? (editDetail.variants.find((variant) => variant.id === editing?.variantId) ??
      editDetail.variants.find((variant) => variant.isActive) ??
      editDetail.variants[0] ??
      null)
    : null;
  const editInitialValues: ProductFormValues | undefined = editDetail
    ? {
        nameEn: editDetail.product.nameI18n.en ?? '',
        sku: editingVariant?.sku ?? '',
        barcode: editingVariant?.barcode ?? '',
        priceAmountMinor: editingVariant?.price.amountMinor ?? '0',
        priceCurrency: editingVariant?.price.currency ?? 'USD',
        costAmountMinor: editingVariant?.cost.amountMinor ?? '0',
        costCurrency: editingVariant?.cost.currency ?? 'USD',
        reorderPoint: editingVariant?.reorderPoint ?? '0',
        reorderQuantity: editingVariant?.reorderQuantity ?? '0',
      }
    : undefined;
  // INV-10 guard for the edit form: every other SKU in the org is reserved,
  // including the siblings of the variant being edited. Only the edited
  // variant's own SKU is free — compared case-insensitively, matching the
  // form's duplicate check and the backend's case-insensitive INV-10 rule.
  const editExistingSkus = (data?.items ?? [])
    .flatMap((product) => product.variants.map((variant) => variant.sku))
    .filter((sku) => editingVariant === null || sku.toLowerCase() !== editingVariant.sku.toLowerCase());

  const handleCreate = async (values: ProductFormValues) => {
    setError(null);
    setSuccess(null);
    try {
      await createProduct.mutateAsync({
        nameI18n: { en: values.nameEn },
        sku: values.sku,
        barcode: values.barcode || null,
        price: { amountMinor: values.priceAmountMinor, currency: values.priceCurrency },
        cost: { amountMinor: values.costAmountMinor, currency: values.costCurrency },
        reorderPoint: values.reorderPoint,
        reorderQuantity: values.reorderQuantity,
      });
      setSuccess(t('products.createdMessage'));
      setShowForm(false);
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    }
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setError(null);
    setSuccess(null);
    try {
      await archiveProduct.mutateAsync(archiveTarget.id);
      setSuccess(t('products.archivedMessage'));
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    } finally {
      setArchiveTarget(null);
    }
  };

  const handleUnarchive = async () => {
    if (!unarchiveTarget) return;
    setError(null);
    setSuccess(null);
    try {
      await unarchiveProduct.mutateAsync(unarchiveTarget.id);
      setSuccess(t('products.unarchivedMessage'));
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    } finally {
      setUnarchiveTarget(null);
    }
  };

  /** Archive ONE variant (INV-11 soft delete) — the product stays active while any sibling sells. */
  const handleArchiveVariant = async () => {
    if (!variantArchiveTarget) return;
    setError(null);
    setSuccess(null);
    try {
      await archiveVariant.mutateAsync({
        variantId: variantArchiveTarget.id,
        productId: variantArchiveTarget.productId,
      });
      setSuccess(t('variants.archivedMessage'));
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    } finally {
      setVariantArchiveTarget(null);
    }
  };

  /** Restore ONE archived variant (INV-11 inverse; SKU reclamation is guarded server-side). */
  const handleUnarchiveVariant = async () => {
    if (!variantUnarchiveTarget) return;
    setError(null);
    setSuccess(null);
    try {
      await unarchiveVariant.mutateAsync({
        variantId: variantUnarchiveTarget.id,
        productId: variantUnarchiveTarget.productId,
      });
      setSuccess(t('variants.unarchivedMessage'));
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    } finally {
      setVariantUnarchiveTarget(null);
    }
  };

  /** Save edits: product name (PATCH product) + the edited variant (PATCH variant). */
  const handleEdit = async (values: ProductFormValues) => {
    if (!editing || !editDetail || !editingVariant) return;
    setError(null);
    setSuccess(null);
    try {
      await updateProduct.mutateAsync({ id: editing.productId, nameI18n: { en: values.nameEn } });
      await updateVariant.mutateAsync({
        productId: editing.productId,
        variantId: editingVariant.id,
        sku: values.sku,
        barcode: values.barcode || null,
        price: { amountMinor: values.priceAmountMinor, currency: values.priceCurrency },
        cost: { amountMinor: values.costAmountMinor, currency: values.costCurrency },
        reorderPoint: values.reorderPoint,
        reorderQuantity: values.reorderQuantity,
      });
      setSuccess(t('products.editedMessage'));
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    }
  };

  return (
    <ModuleGate moduleKey="inventory">
      <div className="space-y-6 animate-fade-in">
        <InventoryModuleNav />
        <InventoryPageHeader
          icon={Package}
          title={t('products.title')}
          subtitle={t('products.subtitle')}
          actions={
            <Button onClick={() => setShowForm((current) => !current)}>
              <PackagePlus className="size-4" aria-hidden="true" />
              <span className="ms-1">{t('products.create')}</span>
            </Button>
          }
        />

        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t(error)}
          </p>
        )}
        {success && (
          <p
            role="status"
            className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
          >
            {success}
          </p>
        )}

        {showForm && <ProductForm onSubmit={handleCreate} pending={createProduct.isPending} />}

        {editing !== null &&
          (editInitialValues ? (
            <div className="space-y-3">
              <ProductForm
                onSubmit={handleEdit}
                pending={updateProduct.isPending || updateVariant.isPending}
                initialValues={editInitialValues}
                existingSkus={editExistingSkus}
                submitLabel={global('common.save')}
              />
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                {global('common.cancel')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{global('common.loading')}</p>
          ))}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('products.searchPlaceholder')}
              className="ps-9"
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => update({ status: value })}
            aria-label={t('products.filterStatus')}
            className="w-44"
          >
            <SelectItem value="">{t('products.allStatuses')}</SelectItem>
            <SelectItem value="active">{t('products.active')}</SelectItem>
            <SelectItem value="archived">{t('products.archived')}</SelectItem>
          </Select>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={() => update({ q: '', status: '' })}>
              <X />
              {t('list.resetFilters')}
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('products.tableSku')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('products.tablePrice')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('products.tableReorder')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('products.tableStatus')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('products.tableActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isPending && !data ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        {global('common.loading')}
                      </td>
                    </tr>
                  ) : (data?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        {t('products.empty')}
                      </td>
                    </tr>
                  ) : (
                    data?.items.map((product) => (
                      <Fragment key={product.id}>
                        {/* Product group header — name link + counts + product-scoped actions. */}
                        <tr className="bg-muted/40">
                          <td colSpan={4} className="px-4 py-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/${locale}/m/inventory/products/${product.id}`}
                                className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                                dir="auto"
                              >
                                {localizedLabel(product.nameI18n, locale, '—')}
                              </Link>
                              {product.variantCount > 0 ? (
                                <Badge variant="outline" className="tabular-nums">
                                  {product.variantCount}
                                </Badge>
                              ) : null}
                              <Badge variant={product.isActive ? 'default' : 'secondary'}>
                                {product.isActive ? t('products.active') : t('products.archived')}
                              </Badge>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-end">
                            {product.isActive ? (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setEditing({
                                      productId: product.id,
                                      variantId: product.variants[0]?.id ?? null,
                                    })
                                  }
                                >
                                  <Pencil className="size-4" aria-hidden="true" />
                                  <span className="ms-1">{t('products.edit')}</span>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setArchiveTarget({
                                      id: product.id,
                                      name: localizedLabel(product.nameI18n, locale, product.sku ?? ''),
                                    })
                                  }
                                >
                                  {t('products.archive')}
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setUnarchiveTarget({
                                    id: product.id,
                                    name: localizedLabel(product.nameI18n, locale, product.sku ?? ''),
                                  })
                                }
                              >
                                <ArchiveRestore className="size-4" aria-hidden="true" />
                                <span className="ms-1">{t('products.unarchive')}</span>
                              </Button>
                            )}
                          </td>
                        </tr>
                        {product.variants.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-3 text-center text-muted-foreground">
                              —
                            </td>
                          </tr>
                        ) : (
                          product.variants.map((variant) => (
                            <tr key={variant.id} className="transition-colors hover:bg-accent/30">
                              <td className="px-4 py-3 font-mono text-xs">{variant.sku}</td>
                              <td className="px-4 py-3 font-mono text-xs tabular-nums">
                                {formatMinorAmount(variant.price.amountMinor, variant.price.currency, {
                                  locale,
                                  exponent: currencies?.find((c) => c.code === variant.price.currency)?.exponent ?? 2,
                                })}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs tabular-nums">{variant.reorderPoint}</td>
                              <td className="px-4 py-3">
                                <Badge variant={variant.isActive ? 'default' : 'secondary'}>
                                  {variant.isActive ? t('products.active') : t('products.archived')}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-end">
                                <VariantRowActions
                                  isActive={variant.isActive}
                                  onEdit={() => setEditing({ productId: product.id, variantId: variant.id })}
                                  onArchive={() =>
                                    setVariantArchiveTarget({
                                      productId: product.id,
                                      id: variant.id,
                                      name: variant.sku,
                                    })
                                  }
                                  onRestore={() =>
                                    setVariantUnarchiveTarget({
                                      productId: product.id,
                                      id: variant.id,
                                      name: variant.sku,
                                    })
                                  }
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <InventoryPagination
          page={page}
          pageSize={data?.pageSize ?? INVENTORY_PAGE_SIZE}
          total={data?.total ?? 0}
          loading={isPending}
          onChange={(nextPage) => update({ page: String(nextPage) })}
        />

        <ConfirmDialog
          open={archiveTarget !== null}
          title={t('products.archiveConfirmTitle')}
          description={archiveTarget ? t('products.archiveConfirmBody', { name: archiveTarget.name }) : undefined}
          confirmLabel={t('products.archive')}
          cancelLabel={global('common.cancel')}
          closeLabel={global('common.close')}
          destructive
          loading={archiveProduct.isPending}
          onConfirm={() => void handleArchive()}
          onCancel={() => setArchiveTarget(null)}
        />

        <ConfirmDialog
          open={unarchiveTarget !== null}
          title={t('products.unarchiveConfirmTitle')}
          description={unarchiveTarget ? t('products.unarchiveConfirmBody', { name: unarchiveTarget.name }) : undefined}
          confirmLabel={t('products.unarchive')}
          cancelLabel={global('common.cancel')}
          closeLabel={global('common.close')}
          loading={unarchiveProduct.isPending}
          onConfirm={() => void handleUnarchive()}
          onCancel={() => setUnarchiveTarget(null)}
        />

        <ConfirmDialog
          open={variantArchiveTarget !== null}
          title={t('variants.archiveConfirmTitle')}
          description={
            variantArchiveTarget ? t('variants.archiveConfirmBody', { sku: variantArchiveTarget.name }) : undefined
          }
          confirmLabel={t('variants.archive')}
          cancelLabel={global('common.cancel')}
          closeLabel={global('common.close')}
          destructive
          loading={archiveVariant.isPending}
          onConfirm={() => void handleArchiveVariant()}
          onCancel={() => setVariantArchiveTarget(null)}
        />

        <ConfirmDialog
          open={variantUnarchiveTarget !== null}
          title={t('variants.unarchiveConfirmTitle')}
          description={
            variantUnarchiveTarget
              ? t('variants.unarchiveConfirmBody', { sku: variantUnarchiveTarget.name })
              : undefined
          }
          confirmLabel={t('variants.unarchive')}
          cancelLabel={global('common.cancel')}
          closeLabel={global('common.close')}
          loading={unarchiveVariant.isPending}
          onConfirm={() => void handleUnarchiveVariant()}
          onCancel={() => setVariantUnarchiveTarget(null)}
        />
      </div>
    </ModuleGate>
  );
}
