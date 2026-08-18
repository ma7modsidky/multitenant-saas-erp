'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, FileText, PackageCheck, Plus, Trash2, Undo2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { ModuleGate } from '@/lib/entitlements';

import type {
  PurchasingBillDetail,
  PurchasingGrnDetail,
  PurchasingSupplier,
  PurchasingSupplierReturn,
} from '@/lib/api/resources';

import { usePurchasingError } from './errors';
import {
  useCurrencies,
  useOrgBaseCurrency,
  usePurchasingBill,
  usePurchasingBills,
  usePurchasingGrn,
  usePurchasingGrns,
  usePurchasingMutations,
  usePurchasingPurchaseOrder,
  usePurchasingReturns,
  usePurchasingSuppliers,
} from './hooks';
import { formatMinorAmount, statusTone } from './labels';
import { PurchasingPageHeader } from './page-header';

const PAGE_SIZE = 20;

const returnFormSchema = z.object({
  supplierId: z.string().min(1),
  reasonCode: z.string().trim().min(1),
  referenceType: z.enum(['bill', 'grn']),
  documentId: z.string().min(1),
});

type ReturnFormValues = z.infer<typeof returnFormSchema>;

/** One editable line in the return — auto-populated from the referenced document. */
interface ReturnLineRow {
  key: string;
  variantId: string | null;
  itemName: string;
  quantity: string;
  unitCostMinor: string;
  unitCostCurrency: string;
}

/** PUR-11: line value = Σ quantity × unit cost, exact integer math (×10⁴ qty). */
function lineAmountMinor(line: ReturnLineRow): string {
  const [whole = '0', frac = '0'] = line.quantity.split('.');
  const fracPadded = frac.padEnd(4, '0').slice(0, 4);
  const scaled = BigInt(whole) * 10000n + BigInt(fracPadded);
  return ((BigInt(line.unitCostMinor) * scaled + 5000n) / 10000n).toString();
}

/**
 * ReturnsView — supplier returns / debit notes (PUR-11). Creating a return
 * picks a reference type (bill or goods receipt), chooses the document for the
 * selected supplier, and the line items are auto-populated from it — the user
 * edits quantities/costs before submitting. Drafts carry a reason code and the
 * returned quantity × unit cost; approval removes stock and reduces AP
 * server-side.
 */
export function ReturnsView() {
  const t = useTranslations('modules.purchasing');
  const locale = useLocale();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const exponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;
  const formatMinor = (amountMinor: string, currency = baseCurrency) =>
    formatMinorAmount(amountMinor, currency, { locale, exponent });

  const [q, setQ] = useState('');
  const [range, setRange] = useState<{ q?: string }>({});
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lines, setLines] = useState<ReturnLineRow[]>([]);
  const populatedFor = useRef<string | null>(null);

  const { data, isPending } = usePurchasingReturns({ ...(range.q ? { q: range.q } : {}), page, pageSize: PAGE_SIZE });
  const { data: suppliersData } = usePurchasingSuppliers({ pageSize: 200 });
  const { createReturn, approveReturn } = usePurchasingMutations();
  const errorKey = usePurchasingError();

  const form = useForm<ReturnFormValues>({
    resolver: zodResolver(returnFormSchema),
    defaultValues: { supplierId: '', reasonCode: '', referenceType: 'bill', documentId: '' },
  });
  const [supplierId, referenceType, documentId] = useWatch({
    control: form.control,
    name: ['supplierId', 'referenceType', 'documentId'],
  });

  // Documents for the selected supplier + reference type (PUR-11).
  const { data: billsData } = usePurchasingBills(supplierId ? { supplierId, pageSize: 200 } : { pageSize: 200 });
  const { data: grnsData } = usePurchasingGrns(supplierId ? { supplierId, pageSize: 200 } : { pageSize: 200 });
  const { data: selectedBill } = usePurchasingBill(referenceType === 'bill' ? documentId : '');
  const { data: selectedGrn } = usePurchasingGrn(referenceType === 'grn' ? documentId : '');
  const { data: grnPo } = usePurchasingPurchaseOrder(selectedGrn?.poId ?? '');

  const documents = useMemo(() => {
    if (!supplierId) return [];
    if (referenceType === 'bill') {
      return (billsData?.items ?? []).map((bill) => ({
        id: bill.id,
        label: `${bill.number} · ${bill.supplierNameSnapshot}`,
      }));
    }
    return (grnsData?.items ?? []).map((grn) => ({ id: grn.id, label: `${grn.number} · ${grn.poNumber}` }));
  }, [supplierId, referenceType, billsData, grnsData]);

  const returnCurrency =
    referenceType === 'bill'
      ? (selectedBill?.currency ?? baseCurrency)
      : (selectedGrn?.lines[0]?.unitCostCurrency ?? baseCurrency);

  // Auto-populate the lines from the referenced document (PUR-11). Guarded by
  // `populatedFor` so late-arriving PO data never clobbers user edits.
  useEffect(() => {
    const docId = documentId;
    if (!docId) return;
    if (referenceType === 'bill') {
      const bill: PurchasingBillDetail | undefined = selectedBill;
      if (!bill || bill.id !== docId || populatedFor.current === `bill:${docId}`) return;
      setLines(
        bill.lines.map((line) => ({
          key: crypto.randomUUID(),
          variantId: line.variantId,
          itemName: line.itemNameSnapshot || '—',
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          unitCostCurrency: line.unitCostCurrency,
        })),
      );
      populatedFor.current = `bill:${docId}`;
    } else {
      const grn: PurchasingGrnDetail | undefined = selectedGrn;
      if (!grn || grn.id !== docId || populatedFor.current === `grn:${docId}`) return;
      if (grn.poId && !grnPo) return; // wait for the PO to resolve item names
      const poLines = grnPo?.lines ?? [];
      setLines(
        grn.lines.map((line) => ({
          key: crypto.randomUUID(),
          variantId: line.variantId,
          itemName: poLines.find((p) => p.id === line.poLineId)?.itemNameSnapshot ?? '—',
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          unitCostCurrency: line.unitCostCurrency,
        })),
      );
      populatedFor.current = `grn:${docId}`;
    }
  }, [referenceType, documentId, selectedBill, selectedGrn, grnPo]);

  const onSupplierChange = (value: string) => {
    form.setValue('supplierId', value);
    form.setValue('documentId', '');
    populatedFor.current = null;
    setLines([]);
  };

  const onReferenceTypeChange = (type: 'bill' | 'grn') => {
    form.setValue('referenceType', type);
    form.setValue('documentId', '');
    populatedFor.current = null;
    setLines([]);
  };

  const onDocumentChange = (id: string) => {
    form.setValue('documentId', id);
    populatedFor.current = null;
  };

  const updateLine = (key: string, patch: Partial<ReturnLineRow>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setSuccess(null);
    if (lines.length === 0) {
      setError(t('returns.noLines'));
      return;
    }
    if (lines.some((line) => Number(line.quantity) <= 0 || Number(line.unitCostMinor) <= 0)) {
      setError(t('returns.positiveValues'));
      return;
    }
    try {
      await createReturn.mutateAsync({
        supplierId: values.supplierId,
        ...(referenceType === 'bill'
          ? { billId: values.documentId }
          : { grnLineId: selectedGrn?.lines[0]?.id ?? null }),
        reasonCode: values.reasonCode,
        currency: returnCurrency,
        lines: lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          unitCostCurrency: line.unitCostCurrency,
        })),
      });
      setSuccess(t('returns.createdMessage'));
      form.reset({ supplierId: '', reasonCode: '', referenceType: 'bill', documentId: '' });
      populatedFor.current = null;
      setLines([]);
      setFormOpen(false);
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : undefined));
    }
  });

  const onApprove = async (id: string) => {
    setError(null);
    setSuccess(null);
    try {
      await approveReturn.mutateAsync({ id });
      setSuccess(t('returns.approvedMessage'));
    } catch (err) {
      setError(errorKey(err instanceof ApiError ? err.code : undefined));
    }
  };

  const totalMinor = lines.reduce((sum, line) => sum + BigInt(lineAmountMinor(line)), 0n).toString();

  return (
    <ModuleGate moduleKey="purchasing">
      <div className="space-y-5">
        <PurchasingPageHeader
          icon={Undo2}
          title={t('returns.title')}
          subtitle={t('returns.subtitle')}
          actions={
            <Button variant="outline" onClick={() => setFormOpen((open) => !open)}>
              <Plus />
              {formOpen ? t('common.hideForm') : t('returns.addAction')}
            </Button>
          }
        />

        {formOpen && (
          <Card>
            <CardHeader>
              <CardTitle>{t('returns.addTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={(event) => void onSubmit(event)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="return-supplier">{t('returns.supplier')}</Label>
                    <Select value={supplierId} onValueChange={onSupplierChange}>
                      {(suppliersData?.items ?? []).map((supplier: PurchasingSupplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name} ({supplier.code})
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="return-reason">{t('returns.reasonCode')}</Label>
                    <Input
                      id="return-reason"
                      {...form.register('reasonCode')}
                      placeholder="defective / damaged / wrong item"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>{t('returns.referenceType')}</Label>
                  <div className="flex flex-wrap gap-2" role="group" aria-label={t('returns.referenceType')}>
                    <Button
                      type="button"
                      size="sm"
                      variant={referenceType === 'bill' ? 'default' : 'outline'}
                      onClick={() => onReferenceTypeChange('bill')}
                    >
                      <FileText />
                      {t('returns.referenceBill')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={referenceType === 'grn' ? 'default' : 'outline'}
                      onClick={() => onReferenceTypeChange('grn')}
                    >
                      <PackageCheck />
                      {t('returns.referenceGrn')}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="return-document">{t('returns.document')}</Label>
                  <Select
                    value={documentId}
                    onValueChange={onDocumentChange}
                    disabled={!supplierId}
                    placeholder={supplierId ? t('returns.selectDocument') : t('returns.selectSupplierFirst')}
                  >
                    {documents.length === 0 && <SelectItem value="">{t('returns.noDocuments')}</SelectItem>}
                    {documents.map((doc) => (
                      <SelectItem key={doc.id} value={doc.id}>
                        {doc.label}
                      </SelectItem>
                    ))}
                  </Select>
                </div>

                {lines.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>{t('returns.linesTitle')}</Label>
                      <span className="text-sm text-muted-foreground">
                        {t('returns.total')}: {formatMinor(totalMinor, returnCurrency)}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-start text-muted-foreground">
                            <th className="py-2 pe-4 text-start font-medium">{t('returns.item')}</th>
                            <th className="py-2 pe-4 text-end font-medium">{t('returns.quantity')}</th>
                            <th className="py-2 pe-4 text-end font-medium">{t('returns.unitCost')}</th>
                            <th className="py-2 text-end font-medium">{t('returns.lineTotal')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((line) => (
                            <tr key={line.key} className="border-b">
                              <td className="py-2 pe-4" dir="auto">
                                {line.itemName}
                              </td>
                              <td className="py-2 pe-4">
                                <Input
                                  type="number"
                                  step="any"
                                  min="0"
                                  aria-label={t('returns.quantity')}
                                  value={line.quantity}
                                  onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                                  className="w-24 text-end"
                                />
                              </td>
                              <td className="py-2 pe-4">
                                <Input
                                  type="number"
                                  step="any"
                                  min="0"
                                  aria-label={t('returns.unitCost')}
                                  value={line.unitCostMinor}
                                  onChange={(event) => updateLine(line.key, { unitCostMinor: event.target.value })}
                                  className="w-32 text-end"
                                />
                              </td>
                              <td className="py-2 text-end font-mono text-xs">
                                {formatMinor(lineAmountMinor(line), returnCurrency)}
                              </td>
                              <td className="py-2 ps-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label={t('returns.removeLine')}
                                  onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                                >
                                  <Trash2 />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}
                {success && <p className="text-sm text-emerald-600">{success}</p>}
                <div className="flex justify-end">
                  <Button type="submit" disabled={createReturn.isPending}>
                    {t('returns.submit')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row">
              <Input
                placeholder={t('returns.searchPlaceholder')}
                value={q}
                onChange={(event) => setQ(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setRange({ q });
                    setPage(1);
                  }
                }}
                className="sm:max-w-xs"
              />
              <Button
                variant="outline"
                onClick={() => {
                  setRange({ q });
                  setPage(1);
                }}
              >
                {t('common.apply')}
              </Button>
            </div>

            {isPending ? (
              <p className="py-8 text-center text-muted-foreground">{t('common.loading')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-start text-muted-foreground">
                      <th className="py-2 pe-4 text-start font-medium">{t('returns.number')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('returns.supplier')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('returns.reasonCode')}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t('returns.status')}</th>
                      <th className="py-2 pe-4 text-end font-medium">{t('returns.amount')}</th>
                      <th className="py-2 text-start font-medium">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.items ?? []).map((ret: PurchasingSupplierReturn) => (
                      <tr key={ret.id} className="border-b">
                        <td className="py-2 pe-4 font-medium">{ret.number}</td>
                        <td className="py-2 pe-4">{ret.supplierNameSnapshot}</td>
                        <td className="py-2 pe-4">{ret.reasonCode}</td>
                        <td className="py-2 pe-4">
                          <Badge variant={statusTone(ret.status)}>{t(`returns.statuses.${ret.status}`)}</Badge>
                        </td>
                        <td className="py-2 pe-4 text-end">{formatMinor(ret.amountMinor, ret.currency)}</td>
                        <td className="py-2">
                          {ret.status === 'draft' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void onApprove(ret.id)}
                              disabled={approveReturn.isPending}
                            >
                              <CheckCircle2 />
                              {t('returns.approve')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(data?.items ?? []).length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted-foreground">
                          {t('returns.empty')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {data && data.total > PAGE_SIZE && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {t('common.pageOf', { page: data.page, total: Math.ceil(data.total / PAGE_SIZE) })}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    {t('common.previous')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= Math.ceil(data.total / PAGE_SIZE)}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('common.next')}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ModuleGate>
  );
}
