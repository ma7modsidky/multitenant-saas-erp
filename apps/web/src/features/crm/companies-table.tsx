'use client';

// Companies table view — a searchable, sortable list of companies at
// `/m/crm/companies/table`. Reached from the Cards/Table toggle on the
// companies page. All state lives in the URL (`q`, `preset`, `sortBy`,
// `sortDir`, `page`) so views are shareable and the back button behaves.
// Sorting + pagination are server-side.
//
// Like the contacts table, it hosts checkbox selection with a bulk-actions
// bar (Export / Reassign owner / Delete selected) — companies have no merge
// flow, so no merge action appears here.

import { Building2, Plus, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildCsv, downloadCsv } from '@/lib/csv';
import { useSession } from '@/lib/auth/session-context';
import { CRM_PAGE_SIZE } from '@/lib/api/resources';

import { CompanyForm } from './workspace';
import {
  lastActivityAt,
  presetListParams,
  useCompaniesList,
  useCrmData,
  useCrmMutations,
  useMemberName,
  useRecentActivities,
  type CrmListPreset,
} from './hooks';
import {
  BulkActionsBar,
  FilterPresetChips,
  type SortDir,
  SortHeader,
  ViewToggle,
  useCrmTableUrlState,
} from './table-shared';
import { Empty, Pagination } from './workspace';

const PRESET_VALUES: readonly CrmListPreset[] = ['all', 'mine', 'teamPool', 'unassigned', 'recent'];

const isPreset = (value: string | null): value is CrmListPreset => PRESET_VALUES.some((preset) => preset === value);

/** Selected-row snapshot for exports (see contacts-table). */
type SelectedCompany = { id: string; name: string };

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
  const searchParams = useSearchParams();
  const mutations = useCrmMutations();
  const data = useCrmData();
  const memberName = useMemberName();
  const recentActivities = useRecentActivities();
  const { user } = useSession();

  const basePath = `/${locale}/m/crm/companies/table`;
  const { q, sortBy, sortDir, page, searchInput, setSearchInput, update, onSort } = useCrmTableUrlState({
    basePath,
    defaultSortBy: 'updatedAt',
    sortKeys: SORTABLE.map((c) => c.key),
    defaultDir: Object.fromEntries(SORTABLE.map((c) => [c.key, c.defaultDir])),
  });

  const rawPreset = searchParams.get('preset');
  const preset: CrmListPreset = isPreset(rawPreset) ? rawPreset : 'all';
  const list = useCompaniesList({
    page,
    pageSize: CRM_PAGE_SIZE,
    sortBy,
    sortDir,
    ...presetListParams(preset, user?.id),
    ...(q ? { search: q } : {}),
  });

  const [showForm, setShowForm] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkFailures, setBulkFailures] = useState(0);
  const [bulkLastError, setBulkLastError] = useState<unknown>(null);
  const [bulkSuccess, setBulkSuccess] = useState<number | null>(null);
  const [selected, setSelected] = useState<Map<string, SelectedCompany>>(new Map());

  const pageItems = list.data?.items ?? [];
  const pageIds = pageItems.map((c) => c.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPageSelected = pageIds.some((id) => selected.has(id));
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someOnPageSelected && !allOnPageSelected;
  }, [someOnPageSelected, allOnPageSelected]);

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const company of pageItems) {
        if (allOnPageSelected) next.delete(company.id);
        else next.set(company.id, { id: company.id, name: company.name });
      }
      return next;
    });
  };

  const toggleRow = (company: (typeof pageItems)[number]) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(company.id)) next.delete(company.id);
      else next.set(company.id, { id: company.id, name: company.name });
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Map());
    setBulkFailures(0);
    setBulkLastError(null);
  };

  // Sequential per-row requests — each lands in the audit log individually.
  // Professional feedback distinguishes all-success, partial, and all-failed.
  const runBulk = async (run: (id: string) => Promise<unknown>) => {
    const total = selected.size;
    setBulkBusy(true);
    setBulkFailures(0);
    setBulkLastError(null);
    setBulkSuccess(null);
    let failures = 0;
    let lastError: unknown = null;
    for (const id of selected.keys()) {
      try {
        await run(id);
      } catch (err) {
        failures += 1;
        lastError = err;
      }
    }
    setBulkBusy(false);
    setBulkFailures(failures);
    setBulkLastError(lastError);
    if (failures === 0) {
      setBulkSuccess(total);
      clearSelection();
      window.setTimeout(() => setBulkSuccess(null), 4000);
    }
  };

  const exportSelected = () => {
    const headers = ['name', 'domain', 'industry'];
    const rows = [...selected.values()].map((company) => {
      const row =
        pageItems.find((item) => item.id === company.id) ??
        data.companies.data?.items.find((item) => item.id === company.id);
      return [company.name, row?.domain ?? '', row?.industry ?? ''];
    });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`companies-${stamp}.csv`, buildCsv(headers, rows));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Same header as the cards view — the actions belong to both views. */}
      <header className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-primary p-2 text-primary-foreground">
            <Building2 className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('companies.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('companies.subtitle')}</p>
          </div>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus />
          {t('companies.create')}
        </Button>
      </header>

      {showForm && (
        <CompanyForm
          onSubmit={(v) =>
            mutations.createCompany
              .mutateAsync({
                name: v.name,
                domain: v.domain || null,
                industry: v.industry || null,
                address: {
                  street: v.addressStreet || null,
                  city: v.addressCity || null,
                  state: v.addressState || null,
                  postalCode: v.addressPostalCode || null,
                  country: v.addressCountry || null,
                },
              })
              .then(() => setShowForm(false))
          }
          pending={mutations.createCompany.isPending}
          onClose={() => setShowForm(false)}
        />
      )}

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

        {bulkSuccess !== null && (
          <div
            role="status"
            className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
          >
            {t('bulk.success', { count: bulkSuccess })}
          </div>
        )}
        <FilterPresetChips value={preset} onChange={(next) => update({ preset: next === 'all' ? undefined : next })} />

        {selected.size > 0 && (
          <BulkActionsBar
            count={selected.size}
            canWrite
            busy={bulkBusy}
            failures={bulkFailures}
            lastError={bulkLastError}
            onExport={exportSelected}
            onDelete={() =>
              runBulk(async (id) => {
                await mutations.deleteCompany.mutateAsync(id);
              })
            }
            onReassign={(ownerUserId) =>
              runBulk(async (id) => {
                const isUnassigned = ownerUserId === '__unassigned__';
                await mutations.updateCompany.mutateAsync({
                  id,
                  input: { ownerUserId: isUnassigned ? null : ownerUserId },
                });
              })
            }
            onClear={clearSelection}
          />
        )}

        {list.isPending && list.data === undefined ? (
          <Empty loading />
        ) : (list.data?.items.length ?? 0) === 0 ? (
          <Empty loading={false} />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAll}
                      aria-label={t('contacts.selectAll')}
                      className="size-4 accent-primary"
                    />
                  </th>
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
                    {t('companies.tableOwner')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">
                    {t('companies.tableLastActivity')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((company) => (
                  <tr
                    key={company.id}
                    className={`border-b transition-colors last:border-0 hover:bg-accent/40 ${
                      selected.has(company.id) ? 'bg-accent/30' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(company.id)}
                        onChange={() => toggleRow(company)}
                        aria-label={company.name}
                        className="size-4 accent-primary"
                      />
                    </td>
                    <td className="max-w-64 px-3 py-2.5">
                      <Link
                        href={`/${locale}/m/crm/companies/${company.id}`}
                        className="block truncate rounded font-medium hover:underline"
                        dir="auto"
                        // Remember this list location so the detail page's Back
                        // button returns here (cards/table + filters) instead of
                        // a fixed default (details.tsx reads the same key).
                        onClick={() =>
                          sessionStorage.setItem(
                            'crm.companies.back',
                            `${window.location.pathname}${window.location.search}`,
                          )
                        }
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
                    <td className="max-w-40 px-3 py-2.5 truncate text-muted-foreground">
                      {memberName(company.ownerUserId) ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                      {(() => {
                        const at = lastActivityAt(recentActivities.data?.items ?? [], 'company', company.id);
                        return at ? new Date(at).toLocaleDateString(locale) : '—';
                      })()}
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
    </div>
  );
}
