'use client';

import { ArchiveRestore, ArrowLeft, History, Package, PackagePlus, Pencil, Tags, X } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Can } from '@/lib/permissions';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';
import { useMemberName } from '@/lib/hooks/use-member-name';

import { inventoryErrorKey } from './errors';
import { ProductForm, VariantForm } from './forms';
import { useCurrencies, useInventoryMutations, useInventoryProduct } from './hooks';
import { localizedLabel } from './labels';
import { compareQuantity, formatMinorAmount, sumQuantities } from './money';
import type { ProductFormValues, VariantFormValues } from './schemas';

function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

function DetailCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: typeof Package;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * Product detail — product record, variant management (INV-10 add / INV-11
 * archive + unarchive), per-warehouse stock projections, and the product's
 * movement history (INV-1 ledger, read-only). Archived variants stay visible
 * because their history never disappears (INV-11).
 *
 * The add/edit variant FORMS render inline where they are triggered — the add
 * form sits at the top of the variants section, the edit form inside the
 * variant's own card — so no scrolling up to a detached form.
 */
export function ProductDetailView({ id }: { id: string }) {
  const t = useTranslations('modules.inventory');
  const global = useTranslations();
  const locale = useLocale();
  const { data, isPending, isError } = useInventoryProduct(id);
  const { data: currencies } = useCurrencies();
  const memberName = useMemberName();
  const { createVariant, updateProduct, updateVariant, archiveVariant, unarchiveVariant, unarchiveProduct } =
    useInventoryMutations();

  const [showVariantForm, setShowVariantForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(false);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);
  const [unarchiveTarget, setUnarchiveTarget] = useState<{ id: string; name: string } | null>(null);
  const [unarchiveProductTarget, setUnarchiveProductTarget] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const variantsRef = useRef<HTMLDivElement>(null);

  if (isPending && !data)
    return <p className="py-10 text-center text-sm text-muted-foreground">{global('common.loading')}</p>;
  if (isError || !data) return <p className="py-10 text-center text-sm text-destructive">{t('errors.unknown')}</p>;

  const product = data.product;
  const variants = data.variants;
  const name = localizedLabel(product.nameI18n, locale, '—');
  const activeVariants = variants.filter((variant) => variant.isActive);
  const primaryVariant = activeVariants[0] ?? variants[0] ?? null;

  // Header edit prefill — the product form edits the name + primary variant
  // (the header button sits next to this form, so it stays where it is).
  const headerEditInitialValues: ProductFormValues | undefined = editingProduct
    ? {
        nameEn: product.nameI18n.en ?? '',
        sku: primaryVariant?.sku ?? '',
        barcode: primaryVariant?.barcode ?? '',
        priceAmountMinor: primaryVariant?.price.amountMinor ?? '0',
        priceCurrency: primaryVariant?.price.currency ?? 'USD',
        costAmountMinor: primaryVariant?.cost.amountMinor ?? '0',
        costCurrency: primaryVariant?.cost.currency ?? 'USD',
        reorderPoint: primaryVariant?.reorderPoint ?? '0',
        reorderQuantity: primaryVariant?.reorderQuantity ?? '0',
      }
    : undefined;

  /** Opens the add-variant form and reveals it in the variants section. */
  const openVariantForm = () => {
    setShowVariantForm(true);
    // The section button is already in view; the header one needs to scroll
    // down so the newly rendered form is visible instead of hiding below.
    requestAnimationFrame(() => variantsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const handleAddVariant = async (values: VariantFormValues) => {
    setError(null);
    setSuccess(null);
    try {
      await createVariant.mutateAsync({
        productId: id,
        sku: values.sku,
        barcode: values.barcode || null,
        price: { amountMinor: values.priceAmountMinor, currency: values.priceCurrency },
        cost: { amountMinor: values.costAmountMinor, currency: values.costCurrency },
        reorderPoint: values.reorderPoint,
        reorderQuantity: values.reorderQuantity,
      });
      setSuccess(t('variants.addedMessage'));
      setShowVariantForm(false);
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    }
  };

  const handleArchiveVariant = async () => {
    if (!archiveTarget) return;
    setError(null);
    setSuccess(null);
    try {
      await archiveVariant.mutateAsync({ variantId: archiveTarget.id, productId: id });
      setSuccess(t('variants.archivedMessage'));
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    } finally {
      setArchiveTarget(null);
    }
  };

  const handleUnarchiveVariant = async () => {
    if (!unarchiveTarget) return;
    setError(null);
    setSuccess(null);
    try {
      await unarchiveVariant.mutateAsync({ variantId: unarchiveTarget.id, productId: id });
      setSuccess(t('variants.unarchivedMessage'));
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    } finally {
      setUnarchiveTarget(null);
    }
  };

  const handleUnarchiveProduct = async () => {
    if (!unarchiveProductTarget) return;
    setError(null);
    setSuccess(null);
    try {
      await unarchiveProduct.mutateAsync(unarchiveProductTarget.id);
      setSuccess(t('products.unarchivedMessage'));
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    } finally {
      setUnarchiveProductTarget(null);
    }
  };

  /** Save product edits: rename the product + update the primary variant. */
  const handleEditProduct = async (values: ProductFormValues) => {
    if (!primaryVariant) return;
    setError(null);
    setSuccess(null);
    try {
      await updateProduct.mutateAsync({ id, nameI18n: { en: values.nameEn } });
      await updateVariant.mutateAsync({
        productId: id,
        variantId: primaryVariant.id,
        sku: values.sku,
        barcode: values.barcode || null,
        price: { amountMinor: values.priceAmountMinor, currency: values.priceCurrency },
        cost: { amountMinor: values.costAmountMinor, currency: values.costCurrency },
        reorderPoint: values.reorderPoint,
        reorderQuantity: values.reorderQuantity,
      });
      setSuccess(t('products.editedMessage'));
      setEditingProduct(false);
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    }
  };

  /** Save variant edits: PATCH one variant's sellable fields. */
  const handleEditVariant = async (values: VariantFormValues) => {
    if (!editingVariantId) return;
    setError(null);
    setSuccess(null);
    try {
      await updateVariant.mutateAsync({
        productId: id,
        variantId: editingVariantId,
        sku: values.sku,
        barcode: values.barcode || null,
        price: { amountMinor: values.priceAmountMinor, currency: values.priceCurrency },
        cost: { amountMinor: values.costAmountMinor, currency: values.costCurrency },
        reorderPoint: values.reorderPoint,
        reorderQuantity: values.reorderQuantity,
      });
      setSuccess(t('variants.editedMessage'));
      setEditingVariantId(null);
    } catch (err) {
      setError(err instanceof ApiError ? inventoryErrorKey(err.code) : t('errors.unknown'));
    }
  };

  return (
    <ModuleGate moduleKey="inventory">
      <div className="space-y-5 animate-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${locale}/m/inventory/products`}>
                {/* rtl:rotate-180 — the back arrow must point inline-start. */}
                <ArrowLeft className="rtl:rotate-180" />
                {t('detail.back')}
              </Link>
            </Button>
            <h1 className="text-xl font-semibold" dir="auto">
              {name}
            </h1>
            <Badge variant={product.isActive ? 'default' : 'secondary'}>
              {product.isActive ? t('products.active') : t('products.archived')}
            </Badge>
          </div>
          {product.isActive ? (
            <div className="flex flex-wrap items-center gap-2">
              <Can permission="inventory:product:write">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowVariantForm(false);
                    setEditingVariantId(null);
                    setEditingProduct((current) => !current);
                  }}
                >
                  {editingProduct ? (
                    <X className="size-4" aria-hidden="true" />
                  ) : (
                    <Pencil className="size-4" aria-hidden="true" />
                  )}
                  <span className="ms-1">{editingProduct ? t('detail.cancel') : t('products.edit')}</span>
                </Button>
              </Can>
              <Can permission="inventory:product:write">
                <Button
                  onClick={() => {
                    setEditingProduct(false);
                    setEditingVariantId(null);
                    if (showVariantForm) setShowVariantForm(false);
                    else openVariantForm();
                  }}
                >
                  {showVariantForm ? (
                    <X className="size-4" aria-hidden="true" />
                  ) : (
                    <PackagePlus className="size-4" aria-hidden="true" />
                  )}
                  <span className="ms-1">{showVariantForm ? t('detail.cancel') : t('variants.add')}</span>
                </Button>
              </Can>
            </div>
          ) : (
            <Can permission="inventory:product:write">
              <Button variant="outline" onClick={() => setUnarchiveProductTarget({ id: product.id, name })}>
                <ArchiveRestore className="size-4" aria-hidden="true" />
                <span className="ms-1">{t('products.unarchive')}</span>
              </Button>
            </Can>
          )}
        </div>

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

        {editingProduct && headerEditInitialValues && (
          <ProductForm
            onSubmit={handleEditProduct}
            pending={updateProduct.isPending || updateVariant.isPending}
            initialValues={headerEditInitialValues}
            submitLabel={global('common.save')}
          />
        )}

        <DetailCard icon={Package} title={t('detail.productDetails')}>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DetailField label={t('detail.skuCount')} value={variants.length} />
            <DetailField label={t('detail.variantCount')} value={activeVariants.length} />
            <DetailField
              label={t('detail.status')}
              value={
                <Badge variant={product.isActive ? 'default' : 'secondary'}>
                  {product.isActive ? t('products.active') : t('products.archived')}
                </Badge>
              }
            />
            <DetailField label={t('detail.created')} value={formatDate(product.createdAt, locale)} />
            <DetailField label={t('detail.updated')} value={formatDate(product.updatedAt, locale)} />
            <DetailField label={t('detail.createdBy')} value={memberName(product.createdByUserId) ?? '—'} />
            <DetailField label={t('detail.updatedBy')} value={memberName(product.updatedByUserId) ?? '—'} />
          </dl>
        </DetailCard>

        <div ref={variantsRef}>
          <DetailCard
            icon={Tags}
            title={t('variants.title')}
            action={
              product.isActive && (
                <Can permission="inventory:product:write">
                  <Button variant="outline" size="sm" onClick={() => setShowVariantForm((current) => !current)}>
                    <PackagePlus className="size-4" aria-hidden="true" />
                    <span className="ms-1">{showVariantForm ? t('detail.cancel') : t('variants.add')}</span>
                  </Button>
                </Can>
              )
            }
          >
            {/* The add form renders right under the section button — no more
                scrolling up to a detached form at the top of the page. */}
            {showVariantForm && (
              <VariantForm
                onSubmit={handleAddVariant}
                pending={createVariant.isPending}
                // INV-10 pre-check against SELLABLE variants only — archived SKUs
                // are claimable (the unarchive use cases guard reclamation), so
                // they must not block a new variant with the same SKU.
                existingSkus={variants.filter((variant) => variant.isActive).map((variant) => variant.sku)}
                submitLabel={t('variants.add')}
              />
            )}
            {variants.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('variants.empty')}</p>
            ) : (
              <div className="space-y-3">
                {variants.map((variant) => {
                  const onHand = sumQuantities(variant.stock.map((row) => row.quantityOnHand));
                  const available = sumQuantities(variant.stock.map((row) => row.quantityAvailable));
                  return (
                    <div
                      key={variant.id}
                      className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent/30"
                    >
                      {/* The edit form renders inside the variant's own card —
                          the row menu no longer jumps the form to page top. */}
                      {editingVariantId === variant.id && (
                        <VariantForm
                          onSubmit={handleEditVariant}
                          pending={updateVariant.isPending}
                          existingSkus={variants.filter((v) => v.id !== variant.id && v.isActive).map((v) => v.sku)}
                          initialValues={{
                            sku: variant.sku,
                            barcode: variant.barcode ?? '',
                            priceAmountMinor: variant.price.amountMinor,
                            priceCurrency: variant.price.currency,
                            costAmountMinor: variant.cost.amountMinor,
                            costCurrency: variant.cost.currency,
                            reorderPoint: variant.reorderPoint,
                            reorderQuantity: variant.reorderQuantity,
                          }}
                          submitLabel={global('common.save')}
                        />
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm font-semibold" dir="auto">
                            {variant.sku}
                          </span>
                          {variant.barcode && (
                            <span className="font-mono text-xs text-muted-foreground" dir="auto">
                              {variant.barcode}
                            </span>
                          )}
                          <Badge variant={variant.isActive ? 'default' : 'secondary'}>
                            {variant.isActive ? t('products.active') : t('products.archived')}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">
                            {t('detail.onHand')}{' '}
                            <span className="font-mono tabular-nums text-foreground">{onHand}</span>
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {t('detail.available')}{' '}
                            <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                              {available}
                            </span>
                          </span>
                          <Can permission="inventory:product:write">
                            {variant.isActive ? (
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={() => setEditingVariantId(variant.id)}>
                                  <Pencil className="size-4" aria-hidden="true" />
                                  <span className="ms-1">{t('variants.edit')}</span>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setArchiveTarget({ id: variant.id, name: variant.sku })}
                                >
                                  {t('variants.archive')}
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setUnarchiveTarget({ id: variant.id, name: variant.sku })}
                              >
                                <ArchiveRestore className="size-4" aria-hidden="true" />
                                <span className="ms-1">{t('variants.unarchive')}</span>
                              </Button>
                            )}
                          </Can>
                        </div>
                      </div>
                      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <div className="space-y-1">
                          <dt className="text-xs font-medium text-muted-foreground">{t('fields.price')}</dt>
                          <dd className="font-mono text-xs tabular-nums">
                            {formatMinorAmount(variant.price.amountMinor, variant.price.currency, {
                              locale,
                              exponent: currencies?.find((c) => c.code === variant.price.currency)?.exponent ?? 2,
                            })}
                          </dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-xs font-medium text-muted-foreground">{t('fields.cost')}</dt>
                          <dd className="font-mono text-xs tabular-nums">
                            {formatMinorAmount(variant.cost.amountMinor, variant.cost.currency, {
                              locale,
                              exponent: currencies?.find((c) => c.code === variant.cost.currency)?.exponent ?? 2,
                            })}
                          </dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-xs font-medium text-muted-foreground">{t('fields.reorderPoint')}</dt>
                          <dd className="font-mono text-xs tabular-nums">{variant.reorderPoint}</dd>
                        </div>
                        <div className="space-y-1">
                          <dt className="text-xs font-medium text-muted-foreground">{t('fields.reorderQuantity')}</dt>
                          <dd className="font-mono text-xs tabular-nums">{variant.reorderQuantity}</dd>
                        </div>
                      </dl>
                      <p className="mt-3 text-xs text-muted-foreground">
                        <span>
                          {t('detail.createdBy')} {memberName(variant.createdByUserId) ?? '—'}
                        </span>
                        <span aria-hidden="true" className="mx-1">
                          ·
                        </span>
                        <span>
                          {t('detail.updatedBy')} {memberName(variant.updatedByUserId) ?? '—'}
                        </span>
                      </p>
                      {variant.stock.length > 0 && (
                        <div className="mt-3 overflow-x-auto rounded-md border">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b text-muted-foreground">
                                <th className="px-3 py-2 text-start font-medium">{t('detail.tableWarehouse')}</th>
                                <th className="px-3 py-2 text-end font-medium">{t('detail.tableOnHand')}</th>
                                <th className="px-3 py-2 text-end font-medium">{t('detail.tableReserved')}</th>
                                <th className="px-3 py-2 text-end font-medium">{t('detail.tableAvailable')}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {variant.stock.map((row) => (
                                <tr key={row.warehouseId}>
                                  <td className="px-3 py-2">
                                    <Link
                                      href={`/${locale}/m/inventory/warehouses/${row.warehouseId}`}
                                      className="text-primary underline-offset-4 hover:underline"
                                      dir="auto"
                                    >
                                      {row.warehouseName}
                                    </Link>
                                  </td>
                                  <td className="px-3 py-2 text-end font-mono tabular-nums">{row.quantityOnHand}</td>
                                  <td className="px-3 py-2 text-end font-mono tabular-nums">{row.quantityReserved}</td>
                                  <td className="px-3 py-2 text-end font-mono tabular-nums">{row.quantityAvailable}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </DetailCard>
        </div>

        <DetailCard icon={History} title={t('movements.title')}>
          {data.movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('movements.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-start font-medium">{t('movements.tableDate')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('movements.tableType')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('movements.tableWarehouse')}</th>
                    <th className="px-3 py-2 text-end font-medium">{t('movements.tableQuantity')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('movements.tableReason')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.movements.map((movement) => {
                    const incoming = compareQuantity(movement.quantity, '0') > 0;
                    return (
                      <tr key={movement.id} className="transition-colors hover:bg-accent/30">
                        <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted-foreground">
                          {formatDate(movement.occurredAt, locale)}
                        </td>
                        <td className="px-3 py-2">{t(`movements.types.${movement.type}`)}</td>
                        <td className="px-3 py-2 text-muted-foreground" dir="auto">
                          {movement.warehouseName ?? '—'}
                        </td>
                        <td
                          className={`px-3 py-2 text-end font-mono text-xs tabular-nums ${
                            incoming ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'
                          }`}
                        >
                          {incoming ? '+' : ''}
                          {movement.quantity}
                        </td>
                        <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-muted-foreground" dir="auto">
                          {movement.reasonCode ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DetailCard>

        <ConfirmDialog
          open={archiveTarget !== null}
          title={t('variants.archiveConfirmTitle')}
          description={archiveTarget ? t('variants.archiveConfirmBody', { sku: archiveTarget.name }) : undefined}
          confirmLabel={t('variants.archive')}
          cancelLabel={global('common.cancel')}
          closeLabel={global('common.close')}
          destructive
          loading={archiveVariant.isPending}
          onConfirm={() => void handleArchiveVariant()}
          onCancel={() => setArchiveTarget(null)}
        />

        <ConfirmDialog
          open={unarchiveTarget !== null}
          title={t('variants.unarchiveConfirmTitle')}
          description={unarchiveTarget ? t('variants.unarchiveConfirmBody', { sku: unarchiveTarget.name }) : undefined}
          confirmLabel={t('variants.unarchive')}
          cancelLabel={global('common.cancel')}
          closeLabel={global('common.close')}
          loading={unarchiveVariant.isPending}
          onConfirm={() => void handleUnarchiveVariant()}
          onCancel={() => setUnarchiveTarget(null)}
        />

        <ConfirmDialog
          open={unarchiveProductTarget !== null}
          title={t('products.unarchiveConfirmTitle')}
          description={
            unarchiveProductTarget
              ? t('products.unarchiveConfirmBody', { name: unarchiveProductTarget.name })
              : undefined
          }
          confirmLabel={t('products.unarchive')}
          cancelLabel={global('common.cancel')}
          closeLabel={global('common.close')}
          loading={unarchiveProduct.isPending}
          onConfirm={() => void handleUnarchiveProduct()}
          onCancel={() => setUnarchiveProductTarget(null)}
        />
      </div>
    </ModuleGate>
  );
}
