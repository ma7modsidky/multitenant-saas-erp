'use client';

// Deals table view — a searchable, filterable, sortable list of deals at
// `/m/crm/deals/table`. Reached from the Board/Table toggle on the pipeline
// page and from a column's "All time" option (which deep-links with the stage
// pre-applied). All state lives in the URL (`q`, `stage`, `status`, `from`,
// `to`, `sortBy`, `sortDir`, `page`) so views are shareable and the back
// button behaves. Sorting + pagination are server-side; the footer shows the
// exact org-base value of the whole filtered set (`totalValueBaseMinor`),
// independent of the current page.

import { Search, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { CRM_PAGE_SIZE } from '@/lib/api/resources';

import { useCurrencies, useCrmData, useDealsList, useOrgBaseCurrency } from './hooks';
import { formatMinorAmount } from './money';
import { type SortDir, SortHeader, ViewToggle, useCrmTableUrlState } from './table-shared';
import { Empty, Pagination } from './workspace';

/** Deal sort keys the API accepts. */
const isDealStatus = (value: string): value is 'open' | 'won' | 'lost' =>
  value === 'open' || value === 'won' || value === 'lost';

/** Sortable columns: key + localized header (+ first-click direction). */
const SORTABLE: Array<{ key: string; labelKey: string; defaultDir: SortDir }> = [
  { key: 'title', labelKey: 'deals.tableTitle', defaultDir: 'asc' },
  { key: 'value', labelKey: 'deals.tableValue', defaultDir: 'desc' },
  { key: 'updatedAt', labelKey: 'deals.tableUpdated', defaultDir: 'desc' },
];

export function DealsTableView() {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const data = useCrmData();
  const baseCurrency = useOrgBaseCurrency();
  const { data: currencies } = useCurrencies();
  const baseExponent = currencies?.find((c) => c.code === baseCurrency)?.exponent ?? 2;

  const basePath = `/${locale}/m/crm/deals/table`;
  const { q, sortBy, sortDir, page, searchInput, setSearchInput, update, onSort } = useCrmTableUrlState({
    basePath,
    defaultSortBy: 'updatedAt',
    sortKeys: SORTABLE.map((c) => c.key),
    defaultDir: Object.fromEntries(SORTABLE.map((c) => [c.key, c.defaultDir])),
  });

  // URL is the single source of truth for every filter.
  const stage = searchParams.get('stage') ?? '';
  const status = searchParams.get('status') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

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
        <ViewToggle
          cardsHref={`/${locale}/m/crm/deals`}
          tableHref={basePath}
          active="table"
          cardsLabel={t('deals.viewBoard')}
          tableLabel={t('deals.viewTable')}
        />
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
