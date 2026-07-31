'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  Settings,
  Building2,
  Users,
  Shield,
  CreditCard,
  Puzzle,
  ChevronLeft,
  ChevronRight,
  Search,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '../cn';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

interface SidebarProps {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function Sidebar({ collapsed = false, onCollapsedChange }: SidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();

  // Extract locale from pathname
  const locale = pathname.split('/')[1] ?? 'en';

  const navSections: NavSection[] = [
    {
      label: t('nav.platform'),
      items: [
        { icon: LayoutDashboard, label: t('nav.dashboard'), href: `/${locale}/dashboard` },
        { icon: Building2, label: t('nav.organizations'), href: `/${locale}/settings/organization` },
        { icon: Users, label: t('nav.members'), href: `/${locale}/settings/members` },
        { icon: Shield, label: t('nav.roles'), href: `/${locale}/settings/roles` },
        { icon: CreditCard, label: t('nav.billing'), href: `/${locale}/settings/billing` },
        { icon: Settings, label: t('nav.settings'), href: `/${locale}/settings` },
      ],
    },
    {
      label: t('nav.modulesLabel'),
      items: [
        { icon: Puzzle, label: t('modules.crm.name'), href: `/${locale}/m/crm` },
        { icon: Puzzle, label: t('modules.inventory.name'), href: `/${locale}/m/inventory` },
        { icon: Puzzle, label: t('modules.pos.name'), href: `/${locale}/m/pos` },
      ],
    },
  ];

  return (
    <aside
      className={cn(
        'fixed start-0 top-0 z-40 flex h-screen flex-col border-e bg-background transition-all duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      {/* Logo area */}
      <div className={cn(
        'flex h-14 items-center border-b px-4',
        collapsed ? 'justify-center' : 'justify-between',
      )}>
        <Link href={`/${locale}`} className="flex items-center gap-2" aria-label="ModuBiz Home">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            M
          </div>
          {!collapsed && (
            <span className="text-base font-semibold">ModuBiz</span>
          )}
        </Link>
      </div>

      {/* Search (expanded only) */}
      {!collapsed && (
        <div className="px-3 py-3">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={t('shell.search')}
              className="h-8 ps-8 text-sm"
              aria-label={t('shell.search')}
            />
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {navSections.map((section) => (
          <div key={section.label} className="mb-4">
            {!collapsed && (
              <p className="px-3 pb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                        collapsed && 'justify-center px-2',
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden="true" />
                      {!collapsed && (
                        <span className="truncate">{item.label}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom section */}
      <div className="border-t p-2">
        {!collapsed && (
          <Link
            href={`/${locale}/help`}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
          >
            <HelpCircle className="size-4 shrink-0" />
            <span className="truncate">{t('shell.help')}</span>
          </Link>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={cn('mt-1 w-full', collapsed && 'justify-center')}
          onClick={() => onCollapsedChange?.(!collapsed)}
          aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
        >
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <>
              <ChevronLeft className="size-4" />
              <span className="text-xs">{t('shell.collapseSidebar')}</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
}
