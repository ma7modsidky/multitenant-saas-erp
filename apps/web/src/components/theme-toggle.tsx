'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { applyTheme, getStoredTheme, storeTheme, type Theme } from '@/lib/theme';

const THEME_CYCLE: readonly Theme[] = ['light', 'dark', 'system'];

/**
 * Theme toggle — cycles light → dark → system and persists the selection.
 * Shared by the dashboard topbar and the marketing landing topbar.
 *
 * The initial state MUST stay 'light' to match what SSR renders — reading
 * localStorage in the initializer would make the client's first render
 * differ from the server HTML and break hydration. The persisted selection
 * is restored in the effect below (the root layout's inline script already
 * applied it pre-paint, so there is no flash of the wrong theme).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('shell');
  const [theme, setTheme] = useState<Theme>('light');

  // Restore the persisted selection after hydration (idempotent), and follow
  // the OS whenever the stored selection is 'system'.
  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    applyTheme(stored);
  }, []);

  const cycleTheme = () => {
    const nextIndex = (THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length;
    const next = THEME_CYCLE[nextIndex];
    if (!next) return;
    setTheme(next);
    storeTheme(next);
    applyTheme(next);
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={cycleTheme}
      aria-label={t(theme === 'dark' ? 'darkMode' : theme === 'light' ? 'lightMode' : 'systemMode')}
    >
      <ThemeIcon className="size-4" />
    </Button>
  );
}
