'use client';

// Federated search for the sidebar — debounced queries against
// GET /v1/search with a grouped results dropdown.
//
// Keyboard: ↑/↓ move the highlight, Enter opens the selected result, Escape
// closes. Clicking outside closes. Copy is i18n; layout uses logical
// utilities only (RTL-safe).

import { useQuery } from '@tanstack/react-query';
import { FileText, Loader2, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { searchFederated } from '@/lib/api/resources';
import type { SearchResultItem } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session-context';

import { cn } from '../cn';
import { Input } from '../ui/input';

import { NAV_ICONS } from './nav-icons';

/** Grouped results with the flat list index of every entry (keyboard nav). */
interface GroupedEntry {
  labelKey: string;
  results: Array<{ item: SearchResultItem; index: number }>;
}

export function SidebarSearch() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { organizationId } = useSession();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Debounce the input before hitting the API.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  const canSearch = debounced.trim().length >= 2 && organizationId !== null;

  const { data, isFetching, isError } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => searchFederated(debounced),
    enabled: canSearch,
  });

  const groups = useMemo<GroupedEntry[]>(() => {
    const result: GroupedEntry[] = [];
    let index = 0;
    for (const group of data?.results ?? []) {
      const entries = group.results.map((item) => ({ item, index: index++ }));
      if (entries.length > 0) result.push({ labelKey: group.labelKey, results: entries });
    }
    return result;
  }, [data]);

  const flattened = useMemo(() => groups.flatMap((group) => group.results), [groups]);

  // Reset the highlight whenever the result set changes.
  useEffect(() => setActiveIndex(0), [debounced, data]);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Keep the active entry scrolled into view.
  useEffect(() => {
    if (!open) return;
    const el = rootRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const openResult = (href: string) => {
    setOpen(false);
    setQuery('');
    setDebounced('');
    router.push(`/${locale}${href}`);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          setOpen(true);
        } else if (flattened.length > 0) {
          setActiveIndex((i) => (i + 1) % flattened.length);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (open && flattened.length > 0) {
          setActiveIndex((i) => (i - 1 + flattened.length) % flattened.length);
        }
        break;
      case 'Enter': {
        const entry = open && flattened.length > 0 ? flattened[activeIndex] : undefined;
        if (entry) {
          event.preventDefault();
          openResult(entry.item.href);
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const showPanel = open && query.trim().length > 0;

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          placeholder={t('shell.search')}
          className="h-8 ps-8 text-sm"
          aria-label={t('shell.search')}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={showPanel ? 'sidebar-search-results' : undefined}
          autoComplete="off"
        />
      </div>

      {showPanel && (
        <div
          id="sidebar-search-results"
          role="listbox"
          className="absolute start-0 end-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg animate-fade-in"
        >
          {!canSearch ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">{t('search.typeMore')}</p>
          ) : isFetching && !data ? (
            <p className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {t('search.loading')}
            </p>
          ) : isError ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">{t('search.error')}</p>
          ) : flattened.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">{t('search.noResults')}</p>
          ) : (
            <ul>
              {groups.map((group) => (
                <li key={group.labelKey} role="presentation">
                  <p className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t(group.labelKey)}
                  </p>
                  <ul>
                    {group.results.map(({ item, index }) => {
                      const isActive = index === activeIndex;
                      const Icon = (item.icon && NAV_ICONS[item.icon]) || FileText;
                      return (
                        <li key={item.id} role="presentation" data-active={isActive}>
                          <Link
                            href={`/${locale}${item.href}`}
                            role="option"
                            aria-selected={isActive}
                            onClick={() => openResult(item.href)}
                            onMouseEnter={() => setActiveIndex(index)}
                            className={cn(
                              'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                              isActive ? 'bg-accent' : 'hover:bg-accent/60',
                            )}
                          >
                            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium" dir="auto">
                                {item.title}
                              </span>
                              {item.description && (
                                <span className="block truncate text-xs text-muted-foreground" dir="auto">
                                  {item.description}
                                </span>
                              )}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
