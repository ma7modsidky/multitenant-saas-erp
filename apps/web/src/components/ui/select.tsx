'use client';

// Custom accessible select — a trigger button with a themed popover list.
// Built on primitives only (no external menu dependency), matching the
// combobox. The list renders with the `popover` tokens (bg-popover /
// text-popover-foreground), so it is always readable in dark mode — a native
// <select>'s OS-rendered dropdown cannot be themed and used to come out white
// or grey regardless of the app theme.
//
// API mirrors the old native select: `value` + `onValueChange` for controlled
// use, `placeholder`, and `className` (width/height land on the root). The
// attributes react-hook-form's `register()` spreads (`name`/`onChange`/
// `onBlur`/`ref`) keep working: the selection is reported through BOTH the
// register `onChange` (synthetic `{ target: { value } }` event) and
// `onValueChange`.
//
// Keyboard: ArrowUp/Down/Home/End navigate, Enter/Space selects, Escape
// closes. Clicking outside closes. Focus stays on the trigger (like Radix
// Select) — the list follows a virtual highlight.

import { Check, ChevronDown } from 'lucide-react';
import { Children, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { cn } from '../cn';

/** Flatten option label children to plain text for the trigger and list. */
function optionLabel(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(optionLabel).join('');
  return '';
}

export function SelectItem({
  value,
  children,
  ...props
}: React.OptionHTMLAttributes<HTMLOptionElement> & { value: string }) {
  // Data carrier: `Select` reads value/label/disabled from its children's
  // props and renders its own list; the option element is never mounted.
  return (
    <option {...props} value={value}>
      {children}
    </option>
  );
}

type SelectProps = {
  value?: string;
  onValueChange?: (value: string) => void;
  // `| undefined` on every optional prop keeps callers free to pass an
  // explicit undefined under exactOptionalPropertyTypes (the design-system
  // test spreads a partial overrides object and does exactly this).
  placeholder?: string | undefined;
  /** Same shape react-hook-form's register `onChange` accepts. */
  onChange?: ((event: { target: { value: string; name?: string } }) => void) | undefined;
  onBlur?: ((event: React.FocusEvent) => void) | undefined;
  disabled?: boolean | undefined;
  className?: string;
  children?: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
};

interface SelectOption {
  value: string;
  label: string;
  disabled: boolean;
}

export function Select({ value, onValueChange, placeholder, className, children, ref, ...props }: SelectProps) {
  const { onChange, onBlur, disabled, name, id, 'aria-label': ariaLabel, ...rest } = props;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const generatedId = useId();

  const mergeRef = useCallback(
    (el: HTMLButtonElement | null) => {
      triggerRef.current = el;
      if (typeof ref === 'function') {
        ref(el);
      } else if (ref) {
        ref.current = el;
      }
    },
    [ref],
  );

  const options = useMemo<SelectOption[]>(() => {
    const items: SelectOption[] = [];
    Children.forEach(children, (child) => {
      if (isValidElement<{ value?: unknown; disabled?: boolean; children?: React.ReactNode }>(child)) {
        const optionProps = child.props;
        if (typeof optionProps.value === 'string') {
          items.push({
            value: optionProps.value,
            label: optionLabel(optionProps.children),
            disabled: optionProps.disabled === true,
          });
        }
      }
    });
    return items;
  }, [children]);

  // The placeholder renders as a disabled first list item — but only when
  // there is no real "" option (the common "None"/"All" pattern), so the same
  // label never appears twice.
  const listOptions = useMemo<SelectOption[]>(() => {
    if (placeholder !== undefined && !options.some((o) => o.value === '')) {
      return [{ value: '', label: placeholder, disabled: true }, ...options];
    }
    return options;
  }, [options, placeholder]);

  // What the trigger shows: the selected option, or (when uncontrolled) the
  // first option like a native select, or the placeholder.
  const display = useMemo(() => {
    const found = options.find((o) => o.value === value);
    if (found) return found;
    if (value === undefined) return options.find((o) => o.value === '') ?? options[0] ?? null;
    return null;
  }, [options, value]);
  const isEmpty = value === undefined || value === '';

  const listboxId = `${id ?? 'select'}-${generatedId}-listbox`;

  const openPopover = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    const current = listOptions.findIndex((o) => o.value === value && !o.disabled);
    setActiveIndex(
      current >= 0
        ? current
        : Math.max(
            0,
            listOptions.findIndex((o) => !o.disabled),
          ),
    );
  }, [disabled, listOptions, value]);

  const selectOption = useCallback(
    (opt: SelectOption) => {
      if (opt.disabled) return;
      onChange?.({ target: { value: opt.value, ...(name !== undefined ? { name } : {}) } });
      onValueChange?.(opt.value);
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    },
    [name, onChange, onValueChange],
  );

  const stepActive = useCallback(
    (dir: 1 | -1) => {
      if (listOptions.length === 0) return;
      let next = activeIndex;
      for (let i = 0; i < listOptions.length; i += 1) {
        next = (next + dir + listOptions.length) % listOptions.length;
        const candidate = listOptions[next];
        if (candidate !== undefined && !candidate.disabled) {
          setActiveIndex(next);
          return;
        }
      }
    },
    [activeIndex, listOptions],
  );

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

  // Keep the active option scrolled into view (focus stays on the trigger).
  // jsdom does not implement scrollIntoView, so guard before calling it.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const handleTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openPopover();
      else stepActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (!open) return;
    switch (event.key) {
      case 'Home':
        event.preventDefault();
        setActiveIndex(
          Math.max(
            0,
            listOptions.findIndex((o) => !o.disabled),
          ),
        );
        break;
      case 'End': {
        event.preventDefault();
        for (let i = listOptions.length - 1; i >= 0; i -= 1) {
          const opt = listOptions[i];
          if (opt !== undefined && !opt.disabled) {
            setActiveIndex(i);
            break;
          }
        }
        break;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const opt = listOptions[activeIndex];
        if (opt && !opt.disabled) selectOption(opt);
        break;
      }
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const ariaAttrs = {
    ...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {}),
    ...(rest['aria-labelledby'] !== undefined ? { 'aria-labelledby': rest['aria-labelledby'] } : {}),
    ...(rest['aria-describedby'] !== undefined ? { 'aria-describedby': rest['aria-describedby'] } : {}),
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={mergeRef}
        type="button"
        {...ariaAttrs}
        id={id}
        name={name}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPopover())}
        onKeyDown={handleTriggerKeyDown}
        onBlur={onBlur}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors',
          'text-start focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', isEmpty && 'text-muted-foreground')}>
          {display?.label ?? placeholder ?? ''}
        </span>
        <ChevronDown
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg animate-fade-in">
          <ul id={listboxId} ref={listRef} role="listbox" aria-label={ariaLabel} className="max-h-56 overflow-y-auto">
            {listOptions.length === 0 && (
              <li className="px-2 py-2 text-sm text-muted-foreground" role="presentation">
                —
              </li>
            )}
            {listOptions.map((opt, index) => (
              <li key={`${opt.value}-${index}`}>
                {/* role="option" lives on the interactive button so clicks and
                    keyboard events reach the handler (the <li> is a wrapper). */}
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={opt.disabled}
                  role="option"
                  aria-selected={opt.value === value}
                  data-index={index}
                  // Keep focus on the trigger (Radix-style virtual highlight) —
                  // the option still receives the click.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectOption(opt)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                    index === activeIndex ? 'bg-accent' : 'hover:bg-accent/60',
                    opt.disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                  )}
                >
                  <Check
                    className={cn('size-4 shrink-0 text-primary', opt.value === value ? 'opacity-100' : 'opacity-0')}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-start">{opt.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
