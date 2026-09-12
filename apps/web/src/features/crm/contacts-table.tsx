'use client';

// Contacts table view — a searchable, filterable, sortable list of contacts
// at `/m/crm/contacts/table`. Reached from the Cards/Table toggle on the
// contacts page. All state lives in the URL (`q`, `companyId`, `preset`,
// `sortBy`, `sortDir`, `page`) so views are shareable and the back button
// behaves. Sorting + pagination are server-side.
//
// The table also hosts the bulk flows: check rows (selection survives
// pagination), then "Merge selected" opens MergeContactsDialog pre-seeded
// with the checked contacts, or run Delete / Reassign owner / Export from
// the shared bulk-actions bar.

import { Merge, Plus, Search, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { buildCsv, downloadCsv } from '@/lib/csv';
import { Can } from '@/lib/permissions';
import { useSession } from '@/lib/auth/session-context';
import { CRM_PAGE_SIZE } from '@/lib/api/resources';

import { ContactForm } from './workspace';
import {
  lastActivityAt,
  presetListParams,
  useContactsList,
  useCrmData,
  useCrmMutations,
  useMemberName,
  useRecentActivities,
  type CrmListPreset,
} from './hooks';
import { MergeContactsDialog, type MergeContactOption } from './merge-contacts-dialog';
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

/** Selected-row snapshot — carries contact fields so Export can include rows
    checked on pages that are no longer mounted. */
type SelectedContact = MergeContactOption & { email?: string | null; phone?: string | null };

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
  const mutations = useCrmMutations();
  const memberName = useMemberName();
  const recentActivities = useRecentActivities();
  const { user } = useSession();

  const basePath = `/${locale}/m/crm/contacts/table`;
  const { q, sortBy, sortDir, page, searchInput, setSearchInput, update, onSort } = useCrmTableUrlState({
    basePath,
    defaultSortBy: 'updatedAt',
    sortKeys: SORTABLE.map((c) => c.key),
    defaultDir: Object.fromEntries(SORTABLE.map((c) => [c.key, c.defaultDir])),
  });

  const companyId = searchParams.get('companyId') ?? '';
  const rawPreset = searchParams.get('preset');
  const preset: CrmListPreset = isPreset(rawPreset) ? rawPreset : 'all';
  const list = useContactsList({
    page,
    pageSize: CRM_PAGE_SIZE,
    sortBy,
    sortDir,
    ...presetListParams(preset, user?.id),
    ...(q ? { search: q } : {}),
    ...(companyId ? { companyId } : {}),
  });

  const companyName = (id: string | null) => data.companies.data?.items.find((c) => c.id === id)?.name;

  const [showForm, setShowForm] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkFailures, setBulkFailures] = useState(0);
  const [bulkLastError, setBulkLastError] = useState<unknown>(null);
  const [bulkSuccess, setBulkSuccess] = useState<number | null>(null);
  // Selection survives pagination (the page component stays mounted while
  // only the URL changes), so a user can tick rows across several pages and
  // act on them all at once.
  const [selected, setSelected] = useState<Map<string, SelectedContact>>(new Map());

  const pageItems = list.data?.items ?? [];
  const pageIds = pageItems.map((c) => c.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPageSelected = pageIds.some((id) => selected.has(id));
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someOnPageSelected && !allOnPageSelected;
  }, [someOnPageSelected, allOnPageSelected]);

  const snapshotOf = (contact: (typeof pageItems)[number]): SelectedContact => ({
    id: contact.id,
    name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email || '—',
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.phone ? { phone: contact.phone } : {}),
  });

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const contact of pageItems) {
        if (allOnPageSelected) next.delete(contact.id);
        else next.set(contact.id, snapshotOf(contact));
      }
      return next;
    });
  };

  const toggleRow = (contact: (typeof pageItems)[number]) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(contact.id)) next.delete(contact.id);
      else next.set(contact.id, snapshotOf(contact));
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Map());
    setBulkFailures(0);
    setBulkLastError(null);
  };

  // Bulk mutations run sequentially so each request stays small and every
  // row lands in the audit log individually; per-row failures are counted
  // and reported instead of aborting the whole batch. Professional feedback
  // distinguishes all-success, partial, and all-failed with the underlying
  // mapped error (e.g. OWNER_SCOPE_DENIED → crmErrorKey).
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
    } else if (failures < total) {
      // keep selection for retry, failures banner will show
    }
  };

  const exportSelected = () => {
    const headers = ['name', 'email', 'phone', 'company', 'created_at'];
    const rows = [...selected.values()].map((contact) => [
      contact.name,
      contact.email ?? '',
      contact.phone ?? '',
      companyName(data.contacts.data?.items.find((c) => c.id === contact.id)?.companyId ?? null) ?? '',
      data.contacts.data?.items.find((c) => c.id === contact.id)?.createdAt ?? '',
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`contacts-${stamp}.csv`, buildCsv(headers, rows));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Same header as the cards view — the actions belong to both views. */}
      <header className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-primary p-2 text-primary-foreground">
            <Users className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('contacts.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('contacts.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Can permission="crm:contact:write">
            <Button variant="outline" onClick={() => setMergeOpen(true)}>
              <Merge />
              {t('contacts.merge')}
            </Button>
          </Can>
          <Can permission="crm:contact:write">
            <Button onClick={() => setShowForm(!showForm)}>
              <Plus />
              {t('contacts.create')}
            </Button>
          </Can>
        </div>
      </header>

      {showForm && (
        <ContactForm
          onSubmit={(v) =>
            mutations.createContact
              .mutateAsync({
                firstName: v.firstName,
                lastName: v.lastName,
                email: v.email || null,
                phone: v.phone || null,
                secondaryPhone: v.secondaryPhone || null,
                companyId: v.companyId || null,
                preferredLocale: v.preferredLocale || null,
                preferredCurrency: v.preferredCurrency || null,
              })
              .then(() => setShowForm(false))
          }
          pending={mutations.createContact.isPending}
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

        <FilterPresetChips value={preset} onChange={(next) => update({ preset: next === 'all' ? undefined : next })} />

        {bulkSuccess !== null && (
          <div
            role="status"
            className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
          >
            {t('bulk.success', { count: bulkSuccess })}
          </div>
        )}
        {/* Bulk action bar — appears once rows are checked. */}
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
                await mutations.deleteContact.mutateAsync(id);
              })
            }
            onReassign={(ownerUserId) =>
              runBulk(async (id) => {
                const isUnassigned = ownerUserId === '__unassigned__';
                // Reassignment changes only the user owner; the owning team is
                // kept by the backend (TEAM-2/CRM-16 transition rules).
                await mutations.updateContact.mutateAsync({
                  id,
                  input: { ownerUserId: isUnassigned ? null : ownerUserId },
                });
              })
            }
            onClear={clearSelection}
          >
            <Button
              variant="outline"
              size="sm"
              disabled={selected.size < 2 || bulkBusy}
              onClick={() => setMergeOpen(true)}
            >
              <Merge />
              {t('contacts.mergeSelected')}
            </Button>
          </BulkActionsBar>
        )}

        {list.isPending && list.data === undefined ? (
          <Empty loading />
        ) : (list.data?.items.length ?? 0) === 0 ? (
          <Empty loading={false} />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[860px] text-sm">
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
                    {t('contacts.tableCompany')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">
                    {t('contacts.tablePhone')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">
                    {t('contacts.tableOwner')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">
                    {t('contacts.tableLastActivity')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((contact) => (
                  <tr
                    key={contact.id}
                    className={`border-b transition-colors last:border-0 hover:bg-accent/40 ${
                      selected.has(contact.id) ? 'bg-accent/30' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(contact.id)}
                        onChange={() => toggleRow(contact)}
                        aria-label={
                          [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email || 'Contact'
                        }
                        className="size-4 accent-primary"
                      />
                    </td>
                    <td className="max-w-52 px-3 py-2.5">
                      <Link
                        href={`/${locale}/m/crm/contacts/${contact.id}`}
                        className="block truncate rounded font-medium hover:underline"
                        dir="auto"
                        // Remember this list location so the detail page's Back
                        // button returns here (cards/table + filters) instead of
                        // a fixed default (details.tsx reads the same key).
                        onClick={() =>
                          sessionStorage.setItem(
                            'crm.contacts.back',
                            `${window.location.pathname}${window.location.search}`,
                          )
                        }
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
                    <td className="max-w-40 px-3 py-2.5 truncate text-muted-foreground">
                      {memberName(contact.ownerUserId) ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                      {(() => {
                        const at = lastActivityAt(recentActivities.data?.items ?? [], 'contact', contact.id);
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

      <MergeContactsDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        initialSelection={[...selected.values()]}
        onMerged={clearSelection}
      />
    </div>
  );
}
