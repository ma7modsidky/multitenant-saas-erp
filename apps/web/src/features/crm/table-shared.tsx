'use client';

// Shared building blocks for the CRM table views (deals, contacts, companies,
// activities). Each table page owns its URL state (`q`, `sortBy`, `sortDir`,
// `page`) via `useCrmTableUrlState` so views are shareable and the back button
// behaves; `SortHeader` renders a sortable column header; `ViewToggle` is the
// Cards/Table switch that appears on both the card and table pages.

import { Download, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, ArrowUpDown, LayoutGrid, List } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { crmErrorKey } from './errors';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select, SelectItem } from '@/components/ui/select';

import Link from 'next/link';

import { useSession } from '@/lib/auth/session-context';
import { hasPermission } from '@/lib/permissions';

import { useOrgMembers, useTeams, type CrmListPreset } from './hooks';

export type SortDir = 'asc' | 'desc';

/**
 * URL-driven state shared by every CRM table view: debounced search `q`,
 * `sortBy`/`sortDir`, `page`. All state lives in the URL. Entity-specific
 * filters (stage, company, dates, …) are read and written by the caller
 * through `update` with their own param names.
 *
 * @param basePath e.g. `/${locale}/m/crm/contacts/table`
 * @param defaultSortBy The sort applied when none is in the URL — or `''`
 *        when the backend's default ordering should win (activities keep
 *        their incomplete-first ordering until the user picks a sort).
 * @param sortKeys Keys the URL may carry; anything else falls back to the
 *        default. Mirrors the server-side allow-lists.
 * @param defaultDir Per-key first-click direction (text asc, dates desc).
 */
export function useCrmTableUrlState({
  basePath,
  defaultSortBy,
  sortKeys,
  defaultDir = {},
}: {
  basePath: string;
  defaultSortBy: string;
  sortKeys: string[];
  defaultDir?: Record<string, SortDir>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const q = searchParams.get('q') ?? '';
  const rawSortBy = searchParams.get('sortBy') ?? defaultSortBy;
  const sortBy = rawSortBy && sortKeys.includes(rawSortBy) ? rawSortBy : defaultSortBy;
  const sortDir: SortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  // Local input debounced into the `q` param — no refetch per keystroke.
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
      router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput, q, basePath, router, searchParams]);

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
      router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
    },
    [basePath, router, searchParams],
  );

  /** Toggle direction on the active key, or start a new sort on first click. */
  const onSort = (key: string) => {
    if (sortBy === key) update({ sortDir: sortDir === 'asc' ? 'desc' : 'asc' });
    // Text columns start ascending; numeric/date columns descending.
    else update({ sortBy: key, sortDir: defaultDir[key] ?? 'desc' });
  };

  return { q, sortBy, sortDir, page, searchInput, setSearchInput, update, onSort };
}

/** A sortable column header — active state + direction icon, click to sort. */
export function SortHeader({
  label,
  sortKey,
  sortBy,
  sortDir,
  onSort,
}: {
  label: string;
  sortKey: string;
  sortBy: string;
  sortDir: SortDir;
  onSort: (key: string) => void;
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

/**
 * Cards/Table view switch. Rendered on both the card page (table link active)
 * and the table page (cards link active) so the toggle always lands on the
 * matching view — same pattern as the deals Board/Table switch.
 */
export function ViewToggle({
  cardsHref,
  tableHref,
  active,
  cardsLabel,
  tableLabel,
}: {
  cardsHref: string;
  tableHref: string;
  active: 'cards' | 'table';
  cardsLabel: string;
  tableLabel: string;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
      <Button
        asChild
        variant={active === 'cards' ? 'secondary' : 'ghost'}
        size="sm"
        className="h-8"
        aria-pressed={active === 'cards'}
      >
        <Link href={cardsHref}>
          <LayoutGrid />
          {cardsLabel}
        </Link>
      </Button>
      <Button
        asChild
        variant={active === 'table' ? 'secondary' : 'ghost'}
        size="sm"
        className="h-8"
        aria-pressed={active === 'table'}
      >
        <Link href={tableHref}>
          <List />
          {tableLabel}
        </Link>
      </Button>
    </div>
  );
}

const PRESET_ITEMS: Array<{ key: CrmListPreset; labelKey: string }> = [
  { key: 'all', labelKey: 'presets.all' },
  { key: 'mine', labelKey: 'presets.mine' },
  { key: 'teamPool', labelKey: 'presets.teamPool' },
  { key: 'unassigned', labelKey: 'presets.unassigned' },
  { key: 'recent', labelKey: 'presets.recent' },
];

/**
 * Unified ownership filter chips (TEAM-4): All / Assigned to me / Team pool /
 * Unassigned / Created recently. The server clamps every choice to the
 * caller's ceiling, so one control covers members, leaders, and admins —
 * and "My work" no longer duplicates "Assigned to me".
 */
export function FilterPresetChips({
  value,
  onChange,
}: {
  value: CrmListPreset;
  onChange: (preset: CrmListPreset) => void;
}) {
  const t = useTranslations('modules.crm');
  return (
    <div role="group" className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1">
      {PRESET_ITEMS.map((preset) => (
        <Button
          key={preset.key}
          variant={value === preset.key ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8"
          aria-pressed={value === preset.key}
          onClick={() => onChange(preset.key)}
        >
          {t(preset.labelKey)}
        </Button>
      ))}
    </div>
  );
}

/**
 * Bulk-actions bar for checkbox selections. Appears once at least one row is
 * selected; hosts Export, Delete selected (confirm-dialog guarded), and
 * Reassign owner (active-members select), plus any entity-specific action via
 * `children` (e.g. "Merge selected" on contacts).
 */
export function BulkActionsBar({
  count,
  canWrite,
  busy,
  failures,
  lastError,
  onExport,
  onDelete,
  onReassign,
  onClear,
  children,
}: {
  count: number;
  /** Caller resolves the module write permission; false hides destructive actions. */
  canWrite: boolean;
  busy: boolean;
  failures: number;
  lastError?: unknown;
  onExport: () => void;
  onDelete: () => Promise<unknown>;
  onReassign: (ownerUserId: string) => Promise<unknown>;
  onClear: () => void;
  children?: React.ReactNode;
}) {
  const t = useTranslations('modules.crm');
  const { data: members } = useOrgMembers();
  const { data: teams } = useTeams();
  const { user, permissions } = useSession();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isAdmin = hasPermission(permissions ?? [], 'platform:members:assign-role');
  // For team-scoped reassign, show only members of my teams (leader/member) unless admin
  const myTeamMemberIds = (() => {
    if (isAdmin) return null; // null = show all
    const myTeams = (teams ?? []).filter((team) => team.memberUserIds.includes(user?.id ?? ''));
    if (myTeams.length === 0) return [user?.id ?? ''].filter(Boolean) as string[];
    const ids = new Set<string>();
    for (const team of myTeams) for (const uid of team.memberUserIds) ids.add(uid);
    // Always include self even if not in team list edge
    if (user?.id) ids.add(user.id);
    return [...ids];
  })();
  const activeMembers = (members ?? [])
    .filter((member) => member.status === 'active')
    .filter((member) => !myTeamMemberIds || myTeamMemberIds.includes(member.userId));
  const succeeded = count - failures;
  const errorMessage = (() => {
    if (!lastError) return null;
    try {
      return t(crmErrorKey(lastError));
    } catch {
      return null;
    }
  })();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
        <p className="text-sm font-medium" aria-live="polite">
          {t('bulk.selectedCount', { count })}
        </p>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={onExport}>
            <Download />
            {t('bulk.export')}
          </Button>
          {canWrite && (
            <>
              {children}
              <Select
                value=""
                onValueChange={(value) => {
                  if (value === '__unassigned__') void onReassign('__unassigned__');
                  else if (value) void onReassign(value);
                }}
                aria-label={t('bulk.reassign')}
                className="w-44"
                disabled={busy}
              >
                <SelectItem value="">{t('bulk.reassign')}</SelectItem>
                <SelectItem value="__unassigned__">{t('common.none')}</SelectItem>
                {activeMembers.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.name || member.email}
                  </SelectItem>
                ))}
              </Select>
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => setConfirmOpen(true)}>
                <Trash2 />
                {t('bulk.delete')}
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
            {t('contacts.clearSelection')}
          </Button>
        </div>
      </div>
      {failures > 0 && failures < count && (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">{t('bulk.partialFailed', { failed: failures, total: count, succeeded })}</p>
          {errorMessage && <p className="mt-1 text-xs opacity-90">{errorMessage}</p>}
        </div>
      )}
      {failures > 0 && failures === count && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p className="font-medium">{t('bulk.allFailed')}</p>
          {errorMessage ? (
            <p className="mt-1 text-xs opacity-90">{errorMessage}</p>
          ) : (
            <p className="mt-1 text-xs opacity-90">{t('bulk.failed', { count: failures })}</p>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={t('bulk.deleteTitle')}
        description={t('bulk.deleteBody', { count })}
        confirmLabel={t('bulk.deleteConfirm')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        destructive
        loading={busy}
        onConfirm={() => {
          void onDelete();
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
