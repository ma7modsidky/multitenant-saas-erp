// Searchable combobox — a text input with a filterable popover list.
// Built on primitives only (no external menu dependency), matching the
// design system in select.tsx. Logical utilities only (ms-/me-/start-/end-)
// so it renders correctly in RTL.
//
// Keyboard: ArrowUp/ArrowDown move the highlight, Enter selects, Escape
// closes. Clicking outside closes the popover.

'use client';

import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '../cn';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional secondary text rendered dimmed next to the label. */
  hint?: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results found',
  id,
  className,
  disabled,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((opt) => opt.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.value.toLowerCase().includes(q) ||
        (opt.hint ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  // Reset highlight whenever the filtered list changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, options]);

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

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const openPopover = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [disabled]);

  const selectOption = useCallback(
    (opt: ComboboxOption) => {
      onValueChange(opt.value);
      setOpen(false);
      setQuery('');
      requestAnimationFrame(() => triggerRef.current?.focus());
    },
    [onValueChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      // Only intercept ArrowDown: Enter/Space fall through to the native
      // button activation (single fire via onClick) — preventing keydown on
      // Space does not reliably cancel the keyup-activated click.
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        openPopover();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length));
        break;
      case 'Enter': {
        e.preventDefault();
        const opt = filtered[activeIndex];
        if (opt) selectOption(opt);
        break;
      }
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setQuery('');
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPopover())}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id ?? 'combobox'}-listbox` : undefined}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors',
          'text-start placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {open ? (
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>
          {selected?.label ?? placeholder}
        </span>
        {selected?.hint && !open && <span className="shrink-0 text-xs text-muted-foreground">{selected.hint}</span>}
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover p-1 shadow-lg animate-fade-in">
          <div className="relative mb-1">
            <Search
              className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              role="combobox"
              aria-expanded
              aria-controls={`${id ?? 'combobox'}-listbox`}
              aria-autocomplete="list"
              className="flex h-8 w-full rounded-md border border-input bg-transparent ps-8 pe-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <ul id={`${id ?? 'combobox'}-listbox`} ref={listRef} role="listbox" className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && (
              <li className="px-2 py-2 text-sm text-muted-foreground" role="presentation">
                {emptyText}
              </li>
            )}
            {filtered.map((opt, index) => {
              const isActive = index === activeIndex;
              const isSelected = opt.value === value;
              return (
                <li key={opt.value} role="option" aria-selected={isSelected} data-index={index}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectOption(opt)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                      isActive ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                  >
                    <Check
                      className={cn('size-4 shrink-0 text-primary', isSelected ? 'opacity-100' : 'opacity-0')}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-start">{opt.label}</span>
                    {opt.hint && <span className="shrink-0 text-xs text-muted-foreground">{opt.hint}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
