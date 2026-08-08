'use client';

import { Lock, Search, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { INVENTORY_PAGE_SIZE } from '@/lib/api/resources';
import { ModuleGate } from '@/lib/entitlements';

import { useCurrencies, useInventoryMovements } from './hooks';
import { localizedLabel } from './labels';
import { compareQuantity, formatMinorAmount } from './money';
import { InventoryPagination, useInventoryListUrlState } from './table-shared';

/** The eight ledger movement types (order matches the `movements.types.*` labels). */
const MOVEMENT_TYPES: readonly string[] = [
  'receipt',
  'sale',
  'return',
  'transfer_in',
  'transfer_out',
  'adjustment',
  'count_correction',
  'write_off',
];

/**
 * The movements toolbar — search, movement-type filter, and from/to dates,
 * all URL-driven (kept separate so the view stays readable).
 */
function MovementsToolbar({
  searchInput,
  onSearchChange,
  type,
  from,
  to,
  hasActiveFilters,
  onFilter,
  onReset,
}: {
  searchInput: string;
  onSearchChange: (value: string) => void;
  type: string;
  from: string;
  to: string;
  hasActiveFilters: boolean;
  onFilter: (patch: Record<string, string | undefined>) => void;
  onReset: () => void;
}) {
  const t = useTranslations('modules.inventory');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="relative min-w-48 flex-1">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('movements.searchPlaceholder')}
          className="ps-9"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{t('movements.filterType')}</Label>
        <Select
          value={type}
          onValueChange={(value) => onFilter({ type: value })}
          aria-label={t('movements.filterType')}
          className="h-9 w-44"
        >
          <SelectItem value="">{t('movements.allTypes')}</SelectItem>
          {MOVEMENT_TYPES.map((movementType) => (
            <SelectItem key={movementType} value={movementType}>
              {t(`movements.types.${movementType}`)}
            </SelectItem>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{t('movements.fromDate')}</Label>
        <Input type="date" value={from} onChange={(event) => onFilter({ from: event.target.value })} className="h-9" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{t('movements.toDate')}</Label>
        <Input type="date" value={to} onChange={(event) => onFilter({ to: event.target.value })} className="h-9" />
      </div>
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <X />
          {t('list.resetFilters')}
        </Button>
      )}
    </div>
  );
}

/**
 * Stock movements — the append-only ledger (INV-1). Read-only by design:
 * there are no edit/delete buttons; corrections are new rows (hard rule #8).
 */
export function MovementsView() {
  const t = useTranslations('modules.inventory');
  const global = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const basePath = `/${locale}/m/inventory/stock/movements`;
  const { q, page, searchInput, setSearchInput, update } = useInventoryListUrlState({ basePath });
  const type = searchParams.get('type') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const hasActiveFilters = Boolean(q || type || from || to);
  const { data, isPending } = useInventoryMovements({
    page,
    pageSize: INVENTORY_PAGE_SIZE,
    ...(q ? { search: q } : {}),
    ...(type ? { type } : {}),
    ...(from ? { fromDate: from } : {}),
    ...(to ? { toDate: to } : {}),
  });
  const { data: currencies } = useCurrencies();

  return (
    <ModuleGate moduleKey="inventory">
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('movements.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('movements.subtitle')}</p>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          {t('movements.appendOnlyHint')}
        </p>

        <MovementsToolbar
          searchInput={searchInput}
          onSearchChange={setSearchInput}
          type={type}
          from={from}
          to={to}
          hasActiveFilters={hasActiveFilters}
          onFilter={update}
          onReset={() => update({ q: '', type: '', from: '', to: '' })}
        />

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start font-medium">{t('movements.tableDate')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('movements.tableProduct')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('movements.tableType')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('movements.tableWarehouse')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('movements.tableQuantity')}</th>
                    <th className="px-4 py-3 text-end font-medium">{t('movements.tableUnitCost')}</th>
                    <th className="px-4 py-3 text-start font-medium">{t('movements.tableReason')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isPending && !data ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        {global('common.loading')}
                      </td>
                    </tr>
                  ) : (data?.items.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        {t('movements.empty')}
                      </td>
                    </tr>
                  ) : (
                    data?.items.map((movement) => {
                      const incoming = compareQuantity(movement.quantity, '0') > 0;
                      return (
                        <tr key={movement.id} className="transition-colors hover:bg-accent/30">
                          <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-muted-foreground">
                            {new Date(movement.occurredAt).toLocaleString(locale, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </td>
                          <td className="px-4 py-3 font-medium" dir="auto">
                            {localizedLabel(movement.nameI18n, locale, movement.sku)}
                          </td>
                          <td className="px-4 py-3">{t(`movements.types.${movement.type}`)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{movement.warehouseName ?? '—'}</td>
                          <td
                            className={`px-4 py-3 text-end font-mono text-xs tabular-nums ${
                              incoming ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'
                            }`}
                          >
                            {incoming ? '+' : ''}
                            {movement.quantity}
                          </td>
                          <td className="px-4 py-3 text-end font-mono text-xs tabular-nums text-muted-foreground">
                            {movement.unitCost
                              ? formatMinorAmount(movement.unitCost.amountMinor, movement.unitCost.currency, {
                                  locale,
                                  exponent:
                                    currencies?.find((c) => c.code === movement.unitCost?.currency)?.exponent ?? 2,
                                })
                              : '—'}
                          </td>
                          <td className="max-w-[14rem] truncate px-4 py-3 text-xs text-muted-foreground" dir="auto">
                            {movement.reasonCode ?? '—'}
                          </td>
                        </tr>
                      );
                    })
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
      </div>
    </ModuleGate>
  );
}
