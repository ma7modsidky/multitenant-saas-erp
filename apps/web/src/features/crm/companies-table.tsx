'use client';

// Companies table view — a searchable, sortable list of companies at
// `/m/crm/companies/table`. Reached from the Cards/Table toggle on the
// companies page. All state lives in the URL (`q`, `sortBy`, `sortDir`,
// `page`) so views are shareable and the back button behaves. Sorting +
// pagination are server-side.

import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';

import { Input } from '@/components/ui/input';
import { CRM_PAGE_SIZE } from '@/lib/api/resources';

import { useCompaniesList } from './hooks';
import { type SortDir, SortHeader, ViewToggle, useCrmTableUrlState } from './table-shared';
import { Empty, Pagination } from './workspace';

/** Company sort keys the API accepts. */
const SORTABLE: Array<{ key: string; labelKey: string; defaultDir: SortDir }> = [
  { key: 'name', labelKey: 'companies.tableName', defaultDir: 'asc' },
  { key: 'domain', labelKey: 'companies.tableDomain', defaultDir: 'asc' },
  { key: 'industry', labelKey: 'companies.tableIndustry', defaultDir: 'asc' },
  { key: 'updatedAt', labelKey: 'companies.tableUpdated', defaultDir: 'desc' },
];

export function CompaniesTableView() {
  const t = useTranslations('modules.crm');
  const locale = useLocale();

  const basePath = `/${locale}/m/crm/companies/table`;
  const { q, sortBy, sortDir, page, searchInput, setSearchInput, update, onSort } = useCrmTableUrlState({
    basePath,
    defaultSortBy: 'updatedAt',
    sortKeys: SORTABLE.map((c) => c.key),
    defaultDir: Object.fromEntries(SORTABLE.map((c) => [c.key, c.defaultDir])),
  });

  const list = useCompaniesList({
    page,
    pageSize: CRM_PAGE_SIZE,
    sortBy,
    sortDir,
    ...(q ? { search: q } : {}),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('companies.searchPlaceholder')}
            className="ps-9"
          />
        </div>
        <ViewToggle
          cardsHref={`/${locale}/m/crm/companies`}
          tableHref={basePath}
          active="table"
          cardsLabel={t('companies.viewCards')}
          tableLabel={t('companies.viewTable')}
        />
      </div>

      {list.isPending && list.data === undefined ? (
        <Empty loading />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <Empty loading={false} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[560px] text-sm">
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
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((company) => (
                <tr key={company.id} className="border-b transition-colors last:border-0 hover:bg-accent/40">
                  <td className="max-w-64 px-3 py-2.5">
                    <Link
                      href={`/${locale}/m/crm/companies/${company.id}`}
                      className="block truncate rounded font-medium hover:underline"
                      dir="auto"
                    >
                      {company.name}
                    </Link>
                  </td>
                  <td className="max-w-48 px-3 py-2.5 text-muted-foreground" dir="auto">
                    {company.domain ?? '—'}
                  </td>
                  <td className="max-w-48 px-3 py-2.5 text-muted-foreground" dir="auto">
                    {company.industry ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                    {company.updatedAt ? new Date(company.updatedAt).toLocaleDateString(locale) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        pageSize={list.data?.pageSize ?? CRM_PAGE_SIZE}
        total={list.data?.total ?? 0}
        loading={list.isPending}
        onChange={(nextPage) => update({ page: String(nextPage) })}
      />
    </div>
  );
}
