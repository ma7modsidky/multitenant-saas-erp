'use client';

// Deals table view — a searchable, filterable, sortable list of deals at
// `/m/crm/deals/table`. Reached from the Board/Table toggle on the pipeline
// page and from a column's "All time" option (which deep-links with the stage
// pre-applied). All state lives in the URL (`q`, `stage`, `status`, `from`,
// `to`, `sortBy`, `sortDir`, `page`) so views are shareable and the back
// button behaves. Sorting + pagination are server-side; the footer shows the
// exact org-base value of the whole filtered set (`totalValueBaseMinor`),
// independent of the current page.

import { ArrowDown, ArrowUp, ArrowUpDown, LayoutGrid, List, Search, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { CRM_PAGE_SIZE } from '@/lib/api/resources';

import { useCurrencies, useCrmData, useDealsList, useOrgBaseCurrency } from './hooks';
import { formatMinorAmount } from './money';
import { Empty, Pagination } from './workspace';

/** Deal sort keys the API accepts. */
type SortKey = 'updatedAt' | 'createdAt' | 'title' | 'value';

const isSortKey = (value: string): value is SortKey =>
  value === 'updatedAt' || value === 'createdAt' || value === 'title' || value === 'value';

const isDealStatus = (value: string): value is 'open' | 'won' | 'lost' =>
  value === 'open' || value === 'won' || value === 'lost';

/** Sortable columns: key + localized header. */
const SORTABLE: Array<{ key: SortKey; labelKey: string }> = [
  { key: 'title', labelKey: 'deals.tableTitle' },
  { key: 'value', labelKey: 'deals.tableValue' },
  { key: 'updatedAt', labelKey: 'deals.tableUpdated' },
];

export function DealsTableView() {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const data = useCrmData();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const baseExponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;

  // URL is the single source of truth for every filter.
  const q = searchParams.get('q') ?? '';
  const stage = searchParams.get('stage') ?? '';
  const status = searchParams.get('status') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const rawSortBy = searchParams.get('sortBy') ?? 'updatedAt';
  const sortBy = isSortKey(rawSortBy) ? rawSortBy : 'updatedAt';
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  // Local input debounced into the `q` param — no refetch per keystroke.
  // The update is inlined here (rather than calling `update`) so the effect
  // closes over nothing unstable; the `searchInput === q` guard keeps it from
  // firing when the URL changed for another reason (e.g. a filter click).
  const [searchInput, setSearchInput] = useState(q);
  useEffect(() => setSearchInput(q), [q]);
  useEffect(() => {
    if (searchInput === q) return;
    const id = setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());
      if (searchInput) next.set('q', searchInput);
      else next.delete('q');
      next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `/${locale}/m/crm/deals/table?${qs}` : `/${locale}/m/crm/deals/table`, {
        scroll: false,
      });
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput, q, locale, router, searchParams]);

  /** Merge a patch into the URL; any non-`page` change resets to page 1. */
  const update = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
      if (!('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `/${locale}/m/crm/deals/table?${qs}` : `/${locale}/m/crm/deals/table`, {
        scroll: false,
      });
    },
    [locale, router, searchParams],
  );

  const onSort = (key: SortKey) => {
    if (sortBy === key) update({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' });
    // Text columns start ascending; numeric/date columns descending.
    else update({ sortBy: key, sortDir: key === 'title' ? 'asc' : 'desc' });
  };

  const list = useDealsList({
    page,
    pageSize: CRM_PAGE_SIZE,
    sortBy,
    sortDir,
    ...(q ? { search: q } : {}),
    ...(stage ? { stageId: stage } : {}),
    ...(isDealStatus(status) ? { status } : {}),
    ...(from ? { fromDate: from } : {}),
    ...(to ? { toDate: to } : {}),
  });

  const stageName = (stageId: string) => {
    const found = data.pipeline.data?.stages.find((s) => s.id === stageId);
    return found ? (found.nameI18n[locale] ?? found.nameI18n.en) : '—';
  };
  const statusLabel = (value: string) =>
    value === 'won' ? t('deals.won') : value === 'lost' ? t('deals.lost') : t('deals.open');
  const hasActiveFilters = Boolean(q || stage || status || from || to);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('deals.searchPlaceholder')}
            className="ps-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
          <Button asChild variant="ghost" size="sm" className="h-8">
            <Link href={`/${locale}/m/crm/deals`}>
              <LayoutGrid />
              {t('deals.viewBoard')}
            </Link>
          </Button>
          <Button variant="secondary" size="sm" className="h-8" aria-pressed>
            <List />
            {t('deals.viewTable')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('deals.tableStage')}</Label>
          <Select
            value={stage}
            onValueChange={(value) => update({ stage: value })}
            aria-label={t('deals.tableStage')}
            className="h-9 w-44"
          >
            <SelectItem value="">{t('deals.allStages')}</SelectItem>
            {(data.pipeline.data?.stages ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.nameI18n[locale] ?? s.nameI18n.en}
              </SelectItem>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('deals.statusFilter')}</Label>
          <Select
            value={status}
            onValueChange={(value) => update({ status: value })}
            aria-label={t('deals.statusFilter')}
            className="h-9 w-36"
          >
            <SelectItem value="">{t('deals.allStatuses')}</SelectItem>
            <SelectItem value="open">{t('deals.open')}</SelectItem>
            <SelectItem value="won">{t('deals.won')}</SelectItem>
            <SelectItem value="lost">{t('deals.lost')}</SelectItem>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('deals.fromDate')}</Label>
          <Input type="date" value={from} onChange={(event) => update({ from: event.target.value })} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('deals.toDate')}</Label>
          <Input type="date" value={to} onChange={(event) => update({ to: event.target.value })} className="h-9" />
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={() => update({ q: '', stage: '', status: '', from: '', to: '' })}>
            <X />
            {t('deals.resetFilters')}
          </Button>
        )}
      </div>

      {list.isPending && list.data === undefined ? (
        <Empty loading />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <Empty loading={false} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                {SORTABLE.map(({ key, labelKey }) => (
                  <SortHeader
                    key={key}
                    label={t(labelKey)}
                    sortKey={key}
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={onSort}
                  />
                ))}
                <th scope="col" className="px-3 py-2.5 text-start font-medium">
                  {t('deals.tableStage')}
                </th>
                <th scope="col" className="px-3 py-2.5 text-start font-medium">
                  {t('deals.tableContact')}
                </th>
                <th scope="col" className="px-3 py-2.5 text-start font-medium">
                  {t('deals.tableStatus')}
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((deal) => (
                <tr key={deal.id} className="border-b transition-colors last:border-0 hover:bg-accent/40">
                  <td className="max-w-56 px-3 py-2.5">
                    <Link
                      href={`/${locale}/m/crm/deals/${deal.id}`}
                      className="block truncate rounded font-medium hover:underline"
                      dir="auto"
                    >
                      {deal.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 font-mono tabular-nums">
                    {formatMinorAmount(deal.value.amountMinor, deal.value.currency, {
                      locale,
                      exponent: currencies?.find((c) => c.code === deal.value.currency)?.exponent ?? 2,
                    })}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                    {deal.updatedAt ? new Date(deal.updatedAt).toLocaleDateString(locale) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline">{stageName(deal.stageId)}</Badge>
                  </td>
                  <td className="max-w-48 px-3 py-2.5 text-muted-foreground" dir="auto">
                    {[deal.contactName, deal.companyName].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge
                      variant={deal.status === 'won' ? 'default' : deal.status === 'lost' ? 'destructive' : 'secondary'}
                    >
                      {statusLabel(deal.status)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t('deals.tableSummary', {
            count: list.data?.total ?? 0,
            value: formatMinorAmount(list.data?.totalValueBaseMinor ?? '0', baseCurrency, {
              locale,
              exponent: baseExponent,
            }),
          })}
        </p>
        <Pagination
          page={page}
          pageSize={list.data?.pageSize ?? CRM_PAGE_SIZE}
          total={list.data?.total ?? 0}
          loading={list.isPending}
          onChange={(nextPage) => update({ page: String(nextPage) })}
        />
      </div>
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sortBy,
  sortDir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sortBy: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}) {
  const active = sortBy === sortKey;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      scope="col"
      className="px-3 py-2.5 text-start font-medium"
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {label}
        <Icon className={active ? 'size-3.5' : 'size-3.5 opacity-50'} />
      </button>
    </th>
  );
}
