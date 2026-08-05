'use client';

// Shared building blocks for the CRM table views (deals, contacts, companies,
// activities). Each table page owns its URL state (`q`, `sortBy`, `sortDir`,
// `page`) via `useCrmTableUrlState` so views are shareable and the back button
// behaves; `SortHeader` renders a sortable column header; `ViewToggle` is the
// Cards/Table switch that appears on both the card and table pages.

import { ArrowDown, ArrowUp, ArrowUpDown, LayoutGrid, List } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import Link from 'next/link';

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
