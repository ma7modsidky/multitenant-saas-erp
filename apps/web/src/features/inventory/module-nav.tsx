'use client';

// Shared page furniture for the inventory module — the CRM-style header card
// and the horizontal sub-navigation with icons above it. The module nav shows
// the four top-level sections (Products / Warehouses / Stock / Stock counts);
// the stock section tabs make the stock sub-routes (Movements / Transfers /
// Reservations) reachable from any of them, matching the sidebar hierarchy.

import { BarChart3, ClipboardList, History, Lock, Package, Repeat, Warehouse, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { cn } from '@/components/cn';

/** The four top-level inventory sections, with icons, shown above every header. */
export function InventoryModuleNav() {
  const t = useTranslations('modules.inventory');
  const locale = useLocale();
  const pathname = usePathname();
  const base = `/${locale}/m/inventory`;

  const items: Array<{ href: string; label: string; icon: LucideIcon; match: (path: string) => boolean }> = [
    {
      href: `${base}/products`,
      label: t('nav.products'),
      icon: Package,
      match: (p) => p.startsWith(`${base}/products`),
    },
    {
      href: `${base}/warehouses`,
      label: t('nav.warehouses'),
      icon: Warehouse,
      match: (p) => p.startsWith(`${base}/warehouses`),
    },
    {
      href: `${base}/stock`,
      label: t('nav.stock'),
      icon: BarChart3,
      // The Stock tab owns the whole section — movements/transfers/
      // reservations are its sub-routes, so they highlight Stock too.
      match: (p) => p.startsWith(`${base}/stock`),
    },
    {
      href: `${base}/stock-counts`,
      label: t('nav.stockCounts'),
      icon: ClipboardList,
      match: (p) => p.startsWith(`${base}/stock-counts`),
    },
  ];

  return (
    <nav aria-label={t('nav.sections')} className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
      {items.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <item.icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Stock section tabs — Stock levels + its three sub-routes, with icons. */
export function StockSectionTabs() {
  const t = useTranslations('modules.inventory');
  const locale = useLocale();
  const pathname = usePathname();
  const base = `/${locale}/m/inventory/stock`;
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const items: Array<{ href: string; label: string; icon: LucideIcon }> = [
    { href: base, label: t('stock.title'), icon: BarChart3 },
    { href: `${base}/movements`, label: t('movements.title'), icon: History },
    { href: `${base}/transfers`, label: t('transfers.title'), icon: Repeat },
    { href: `${base}/reservations`, label: t('reservations.title'), icon: Lock },
  ];

  return (
    <nav aria-label={t('stock.related')} className="flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1">
      {items.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              active
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <item.icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The CRM-style page header: icon badge + title + subtitle on the start side,
 * action buttons on the end side. Used by every inventory list view so the
 * module reads consistently (products, warehouses, stock, movements, …).
 */
export function InventoryPageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="rounded-lg bg-primary p-2 text-primary-foreground">
          <Icon className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
