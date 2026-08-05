'use client';

// Contacts table view — a searchable, filterable, sortable list of contacts
// at `/m/crm/contacts/table`. Reached from the Cards/Table toggle on the
// contacts page. All state lives in the URL (`q`, `companyId`, `sortBy`,
// `sortDir`, `page`) so views are shareable and the back button behaves.
// Sorting + pagination are server-side.

import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { CRM_PAGE_SIZE } from '@/lib/api/resources';

import { useContactsList, useCrmData } from './hooks';
import { type SortDir, SortHeader, ViewToggle, useCrmTableUrlState } from './table-shared';
import { Empty, Pagination } from './workspace';

/** Contact sort keys the API accepts. */
const SORTABLE: Array<{ key: string; labelKey: string; defaultDir: SortDir }> = [
  { key: 'name', labelKey: 'contacts.tableName', defaultDir: 'asc' },
  { key: 'email', labelKey: 'contacts.tableEmail', defaultDir: 'asc' },
  { key: 'updatedAt', labelKey: 'contacts.tableUpdated', defaultDir: 'desc' },
];

export function ContactsTableView() {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const data = useCrmData();

  const basePath = `/${locale}/m/crm/contacts/table`;
  const { q, sortBy, sortDir, page, searchInput, setSearchInput, update, onSort } = useCrmTableUrlState({
    basePath,
    defaultSortBy: 'updatedAt',
    sortKeys: SORTABLE.map((c) => c.key),
    defaultDir: Object.fromEntries(SORTABLE.map((c) => [c.key, c.defaultDir])),
  });

  const companyId = searchParams.get('companyId') ?? '';
  const list = useContactsList({
    page,
    pageSize: CRM_PAGE_SIZE,
    sortBy,
    sortDir,
    ...(q ? { search: q } : {}),
    ...(companyId ? { companyId } : {}),
  });

  const companyName = (id: string | null) => data.companies.data?.items.find((c) => c.id === id)?.name;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t('contacts.searchPlaceholder')}
            className="ps-9"
          />
        </div>
        <Select
          value={companyId}
          onValueChange={(value) => update({ companyId: value })}
          aria-label={t('contacts.filterCompany')}
          className="w-48"
        >
          <SelectItem value="">{t('contacts.allCompanies')}</SelectItem>
          {(data.companies.data?.items ?? []).map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </Select>
        <ViewToggle
          cardsHref={`/${locale}/m/crm/contacts`}
          tableHref={basePath}
          active="table"
          cardsLabel={t('contacts.viewCards')}
          tableLabel={t('contacts.viewTable')}
        />
      </div>

      {list.isPending && list.data === undefined ? (
        <Empty loading />
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <Empty loading={false} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[640px] text-sm">
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
                  {t('contacts.tableCompany')}
                </th>
                <th scope="col" className="px-3 py-2.5 text-start font-medium">
                  {t('contacts.tablePhone')}
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((contact) => (
                <tr key={contact.id} className="border-b transition-colors last:border-0 hover:bg-accent/40">
                  <td className="max-w-52 px-3 py-2.5">
                    <Link
                      href={`/${locale}/m/crm/contacts/${contact.id}`}
                      className="block truncate rounded font-medium hover:underline"
                      dir="auto"
                    >
                      {[contact.firstName, contact.lastName].filter(Boolean).join(' ') || '—'}
                    </Link>
                  </td>
                  <td className="max-w-48 px-3 py-2.5 text-muted-foreground" dir="auto">
                    {contact.email ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                    {contact.updatedAt ? new Date(contact.updatedAt).toLocaleDateString(locale) : '—'}
                  </td>
                  <td className="max-w-44 px-3 py-2.5">
                    {contact.companyId && companyName(contact.companyId) ? (
                      <Badge variant="outline" className="truncate text-xs">
                        {companyName(contact.companyId)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="max-w-44 px-3 py-2.5 text-muted-foreground" dir="auto">
                    {contact.phone ?? '—'}
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
