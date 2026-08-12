'use client';

import { Check, MoreVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/components/cn';
import { Button } from '@/components/ui/button';

export interface StageMenuOption {
  id: string;
  /** Localized stage name. */
  label: string;
  /** Deal is currently in this stage — rendered with a check. */
  isCurrent?: boolean;
  /** Lost stage — clicking it must collect a reason (CRM-7). */
  isLost?: boolean;
}

interface StageMenuProps {
  options: StageMenuOption[];
  /** Called with the chosen stage id. */
  onSelect: (stageId: string) => void;
  /** User lacks crm:deal:write or a move is in flight. */
  disabled?: boolean;
  /** Accessible name for the trigger button. */
  ariaLabel: string;
}

const MENU_WIDTH = 192; // w-48
const GAP = 4;

/**
 * StageMenu — compact ⋮ stage switcher for pipeline board cards.
 *
 * The board columns scroll internally (`overflow-y-auto`), so an in-card
 * absolute dropdown would be clipped. The menu is rendered through a portal
 * with fixed positioning anchored to the trigger, closed on outside click,
 * scroll, resize, and Escape. Keyboard: ArrowUp/Down move, Home/End jump,
 * Enter/Space select, Escape closes.
 */
export function StageMenu({ options, onSelect, disabled, ariaLabel }: StageMenuProps) {
  const t = useTranslations('modules.crm');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [style, setStyle] = useState<CSSProperties>({});

  const close = useCallback(() => {
    setOpen(false);
    // Return focus to the trigger so keyboard users stay in place.
    triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rtl = document.documentElement.dir === 'rtl';
    // Estimate height so long stage lists flip above the trigger.
    const estimatedHeight = options.length * 32 + 16;
    const openAbove = rect.bottom + GAP + estimatedHeight > window.innerHeight - 8;
    const nextStyle: CSSProperties = openAbove
      ? { top: Math.max(8, rect.top - estimatedHeight - GAP) }
      : { top: rect.bottom + GAP };
    if (rtl) {
      nextStyle.right = Math.max(8, Math.min(window.innerWidth - rect.right, window.innerWidth - MENU_WIDTH - 8));
    } else {
      nextStyle.left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8));
    }
    setStyle(nextStyle);
    setActiveIndex(
      Math.max(
        0,
        options.findIndex((o) => o.isCurrent),
      ),
    );
    setOpen(true);
  }, [disabled, options]);

  // Close on outside click, scroll (columns scroll internally), and resize.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (target instanceof Node && !menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('scroll', onScrollOrResize, { capture: true });
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('scroll', onScrollOrResize, { capture: true });
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]); // If the menu is open when the user loses write permission or a move starts,
  // close it rather than leaving a stale menu floating.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // Focus the highlighted item when the menu opens or the highlight moves.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.focus();
  }, [open, activeIndex]);

  function handleMenuKeyDown(event: React.KeyboardEvent) {
    if (options.length === 0) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const option = options[activeIndex];
        if (option) onSelect(option.id);
        close();
        break;
      }
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  }

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openMenu())}
        className="size-7 text-muted-foreground hover:text-foreground"
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </Button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={ariaLabel}
            onKeyDown={handleMenuKeyDown}
            style={style}
            className="fixed z-50 w-48 rounded-lg border bg-popover p-1 shadow-lg animate-fade-in"
          >
            {options.map((option, index) => {
              const isActive = index === activeIndex;
              const isCurrent = option.isCurrent === true;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="menuitem"
                  data-index={index}
                  tabIndex={-1}
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => {
                    onSelect(option.id);
                    close();
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                    isActive ? 'bg-accent' : 'hover:bg-accent/60',
                  )}
                >
                  <Check
                    className={cn('size-4 shrink-0 text-primary', isCurrent ? 'opacity-100' : 'opacity-0')}
                    aria-hidden="true"
                  />
                  {/* No text-align utility here: the global dir="auto" block
                      rule aligns menu labels to the document direction (start
                      edge, next to the check icon) in both LTR and RTL — a
                      text-start utility would re-resolve against the label's
                      own content direction and break that alignment. */}
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      isCurrent && 'font-medium',
                      option.isLost && 'text-destructive',
                    )}
                    dir="auto"
                  >
                    {option.label}
                  </span>
                  {option.isLost && (
                    <span className="shrink-0 text-xs text-muted-foreground">{t('detail.statusLost')}</span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
