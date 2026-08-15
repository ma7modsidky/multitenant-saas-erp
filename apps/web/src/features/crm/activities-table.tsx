'use client';

// Activities table view — a searchable, filterable, sortable list of
// activities at `/m/crm/activities/table`. Reached from the Cards/Table
// toggle on the activities page. All state lives in the URL (`q`, `assignee`,
// `status`, `from`, `to`, `sortBy`, `sortDir`, `page`) so views are shareable
// and the back button behaves. Sorting + pagination are server-side.
//
// The default sort is empty on purpose: without a `sortBy` the API returns
// the card view's ordering (incomplete first, soonest due) until the user
// picks a column.

import { Activity, Plus, Search, User, UserX } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { useSession } from '@/lib/auth/session-context';
import { Button } from '@/components/ui/button';
import { CRM_PAGE_SIZE } from '@/lib/api/resources';

import { DueBadge } from './due-badge';
import { ActivityForm } from './forms';
import { useActivitiesList, useCrmMutations, useOrgMembers } from './hooks';
import { type SortDir, SortHeader, ViewToggle, useCrmTableUrlState } from './table-shared';
import { Empty, Pagination } from './workspace';

/** Sentinel value for the "Unassigned" option in the assignee filter. */
const ACTIVITY_ASSIGNEE_UNASSIGNED = '__unassigned__';

/** Activity sort keys the API accepts. */
const SORTABLE: Array<{ key: string; labelKey: string; defaultDir: SortDir }> = [
  { key: 'subject', labelKey: 'activities.tableSubject', defaultDir: 'asc' },
  { key: 'type', labelKey: 'activities.tableType', defaultDir: 'asc' },
  { key: 'dueAt', labelKey: 'activities.tableDue', defaultDir: 'asc' },
];

export function ActivitiesTableView() {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const { user } = useSession();
  const { data: members } = useOrgMembers();
  const activeMembers = (members ?? []).filter((m) => m.status === 'active');

  const mutations = useCrmMutations();
  const [showForm, setShowForm] = useState(false);

  const basePath = `/${locale}/m/crm/activities/table`;
  const { q, sortBy, sortDir, page, searchInput, setSearchInput, update, onSort } = useCrmTableUrlState({
    basePath,
    defaultSortBy: '',
    sortKeys: SORTABLE.map((c) => c.key),
    defaultDir: Object.fromEntries(SORTABLE.map((c) => [c.key, c.defaultDir])),
  });

  const assignee = searchParams.get('assignee') ?? '';
  const status = searchParams.get('status') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';

  const list = useActivitiesList({
    page,
    pageSize: CRM_PAGE_SIZE,
    ...(sortBy ? { sortBy } : {}),
    ...(sortDir && sortBy ? { sortDir } : {}),
    ...(q ? { search: q } : {}),
    ...(assignee === ACTIVITY_ASSIGNEE_UNASSIGNED
      ? { unassigned: true }
      : assignee
        ? { assigneeUserId: assignee }
        : {}),
    ...(status === 'completed' ? { completed: true } : status === 'open' ? { completed: false } : {}),
    ...(from ? { fromDate: from } : {}),
    ...(to ? { toDate: to } : {}),
  });

  const hasActiveFilters = Boolean(q || assignee || status || from || to);
  const memberName = (userId: string | null) => {
    if (!userId) return null;
    const member = (members ?? []).find((m) => m.userId === userId);
    return member ? member.name || member.email : null;
  };
  const relatedHref = (type: string | null, id: string | null) =>
    type && id
      ? `/${locale}/m/crm/${{ contact: 'contacts', company: 'companies', deal: 'deals' }[type] ?? 'activities'}/${id}`
      : null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Same header as the cards view — the actions belong to both views. */}
      <header className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-primary p-2 text-primary-foreground">
            <Activity className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('activities.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('activities.subtitle')}</p>
          </div>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus />
          {t('activities.create')}
        </Button>
      </header>

      {showForm && (
        <ActivityForm
          onSubmit={(v) =>
            mutations.createActivity
              .mutateAsync({
                type: v.type,
                subject: v.subject,
                dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : null,
              })
              .then(() => setShowForm(false))
          }
          pending={mutations.createActivity.isPending}
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
              placeholder={t('activities.searchPlaceholder')}
              className="ps-9"
            />
          </div>
          <ViewToggle
            cardsHref={`/${locale}/m/crm/activities`}
            tableHref={basePath}
            active="table"
            cardsLabel={t('activities.viewCards')}
            tableLabel={t('activities.viewTable')}
          />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('activities.assigneeFilter')}</Label>
            <Select
              value={assignee}
              onValueChange={(value) => update({ assignee: value })}
              className="h-9 w-44"
              aria-label={t('activities.assigneeFilter')}
            >
              <SelectItem value="">{t('activities.allAssignees')}</SelectItem>
              <SelectItem value={ACTIVITY_ASSIGNEE_UNASSIGNED}>{t('activities.unassigned')}</SelectItem>
              {user?.id && <SelectItem value={user.id}>{t('activities.assignedToMe')}</SelectItem>}
              {activeMembers
                .filter((m) => m.userId !== user?.id)
                .map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.name || m.email}
                  </SelectItem>
                ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('activities.statusFilter')}</Label>
            <Select
              value={status}
              onValueChange={(value) => update({ status: value })}
              className="h-9 w-40"
              aria-label={t('activities.statusFilter')}
            >
              <SelectItem value="">{t('activities.allStatuses')}</SelectItem>
              <SelectItem value="open">{t('activities.open')}</SelectItem>
              <SelectItem value="completed">{t('activities.completed')}</SelectItem>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('activities.fromDate')}</Label>
            <Input
              type="date"
              value={from}
              onChange={(event) => update({ from: event.target.value })}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('activities.toDate')}</Label>
            <Input type="date" value={to} onChange={(event) => update({ to: event.target.value })} className="h-9" />
          </div>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => update({ q: '', assignee: '', status: '', from: '', to: '' })}
            >
              {t('activities.resetFilters')}
            </Button>
          )}
        </div>

        {list.isPending && list.data === undefined ? (
          <Empty loading />
        ) : (list.data?.items.length ?? 0) === 0 ? (
          <Empty loading={false} />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[820px] text-sm">
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
                    {t('activities.tableRelated')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">
                    {t('activities.tableAssignee')}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start font-medium">
                    {t('activities.tableStatus')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((activity) => {
                  const related = relatedHref(activity.relatedType, activity.relatedId);
                  return (
                    <tr key={activity.id} className="border-b transition-colors last:border-0 hover:bg-accent/40">
                      <td className="px-3 py-2.5">
                        <Badge variant="outline">{t(`activities.types.${activity.type}`)}</Badge>
                      </td>
                      <td className="max-w-56 px-3 py-2.5">
                        <Link
                          href={`/${locale}/m/crm/activities/${activity.id}`}
                          className="block truncate rounded font-medium hover:underline"
                          dir="auto"
                          // Remember this list location so the activity detail
                          // page's Back button returns here (table + filters).
                          onClick={() =>
                            sessionStorage.setItem(
                              'crm.activities.back',
                              `${window.location.pathname}${window.location.search}`,
                            )
                          }
                        >
                          {activity.subject}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                        {activity.dueAt ? new Date(activity.dueAt).toLocaleDateString(locale) : '—'}
                      </td>
                      <td className="max-w-52 px-3 py-2.5 text-muted-foreground" dir="auto">
                        {activity.relatedName && related ? (
                          <Link href={related} className="block truncate rounded hover:underline">
                            {activity.relatedName}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="max-w-40 px-3 py-2.5">
                        {activity.assignedToUserId ? (
                          memberName(activity.assignedToUserId) ? (
                            <span className="inline-flex items-center gap-1 truncate text-muted-foreground">
                              <User className="size-3 shrink-0" />
                              <span className="truncate">{memberName(activity.assignedToUserId)}</span>
                            </span>
                          ) : null
                        ) : (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <UserX className="size-3" />
                            {t('activities.unassigned')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <DueBadge dueAt={activity.dueAt} completedAt={activity.completedAt} />
                      </td>
                      <td className="px-3 py-2.5">
                        {activity.completedAt ? (
                          <Badge variant="default">{t('activities.completed')}</Badge>
                        ) : (
                          <Badge variant="secondary">{t('activities.open')}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
