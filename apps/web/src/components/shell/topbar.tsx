'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import {
  Bell,
  Moon,
  Sun,
  Monitor,
  LogOut,
  User,
  Settings,
  Building2,
  Keyboard,
  ChevronDown,
  Menu,
} from 'lucide-react';

import { cn } from '../cn';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';

interface TopbarProps {
  onMenuToggle?: () => void;
}

export function Topbar({ onMenuToggle }: TopbarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const locale = pathname.split('/')[1] ?? 'en';
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('light');
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close user menu on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const localeLabels: Record<string, string> = {
    en: 'EN',
    ar: 'AR',
    fr: 'FR',
    es: 'ES',
  };

  const cycleTheme = () => {
    const themes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system'];
    const nextIndex = (themes.indexOf(theme) + 1) % themes.length;
    const next = themes[nextIndex];
    // next is always defined because nextIndex is 0-2 (modulo arithmetic on array of 3)
    if (!next) return;
    setTheme(next);
    if (next === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (next === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      // System preference
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  };

  const themeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const ThemeIcon = themeIcon;

  return (
    <header className="sticky start-0 top-0 z-30 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-full items-center gap-2 px-4">
        {/* Mobile menu toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onMenuToggle}
          aria-label="Toggle menu"
        >
          <Menu className="size-4" />
        </Button>

        {/* Left section */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm">
            <Building2 className="size-3.5 text-muted-foreground" />
            <span className="font-medium">{t('nav.dashboard')}</span>
            <ChevronDown className="size-3 text-muted-foreground" />
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right section */}
        <div className="flex items-center gap-1">
          {/* Locale switcher */}
          <div className="hidden sm:flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground">
            {Object.entries(localeLabels).map(([code, label]) => (
              <Link
                key={code}
                href={pathname.replace(`/${locale}`, `/${code}`)}
                className={cn(
                  'rounded px-1.5 py-0.5 transition-colors hover:text-foreground',
                  code === locale && 'bg-accent text-foreground',
                )}
              >
                {label}
              </Link>
            ))}
          </div>

          <Separator orientation="vertical" className="mx-1 h-6" />

          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={cycleTheme}
            aria-label={t(theme === 'dark' ? 'shell.darkMode' : theme === 'light' ? 'shell.lightMode' : 'shell.systemMode')}
          >
            <ThemeIcon className="size-4" />
          </Button>

          {/* Notifications */}
          <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
            <Bell className="size-4" />
            <span className="absolute end-1.5 top-1.5 size-2 rounded-full bg-destructive" />
          </Button>

          {/* User menu */}
          <div className="relative" ref={userMenuRef}>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 pe-2"
              onClick={() => setShowUserMenu(!showUserMenu)}
              aria-expanded={showUserMenu}
              aria-haspopup="true"
              aria-label={t('shell.userMenu')}
            >
              <div className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                JD
              </div>
              <span className="hidden sm:inline text-sm font-medium">Jane Doe</span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </Button>

            {showUserMenu && (
              <div className="absolute end-0 top-full mt-1 w-56 rounded-lg border bg-popover p-1 shadow-lg animate-fade-in">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">Jane Doe</p>
                  <p className="text-xs text-muted-foreground">jane@example.com</p>
                </div>
                <Separator className="my-1" />
                <Link
                  href={`/${locale}/settings/profile`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  onClick={() => setShowUserMenu(false)}
                >
                  <User className="size-4" />
                  {t('shell.profile')}
                </Link>
                <Link
                  href={`/${locale}/settings`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  onClick={() => setShowUserMenu(false)}
                >
                  <Settings className="size-4" />
                  {t('shell.accountSettings')}
                </Link>
                <Link
                  href={`/${locale}/help`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                  onClick={() => setShowUserMenu(false)}
                >
                  <Keyboard className="size-4" />
                  {t('shell.keyboardShortcuts')}
                </Link>
                <Separator className="my-1" />
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
                  onClick={() => setShowUserMenu(false)}
                >
                  <LogOut className="size-4" />
                  {t('auth.logout')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
